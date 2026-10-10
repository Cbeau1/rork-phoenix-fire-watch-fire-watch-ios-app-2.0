import UIKit

struct ReportRequest: Identifiable {
    let id = UUID()
    let property: Property
    let session: FireWatchSession
    let preparedBy: String
    let orgName: String

    var fileName: String {
        let safe = property.name.replacingOccurrences(of: "[^A-Za-z0-9]+", with: "-", options: .regularExpression)
        let day = session.start.formatted(.iso8601.year().month().day())
        return "Fire-Watch-Report-\(safe)-\(day).pdf"
    }
}

/// Builds the branded shift report PDF (US Letter, light paper) matching the website report.
enum ReportBuilder {
    private static let page = CGRect(x: 0, y: 0, width: 612, height: 792)
    private static let margin: CGFloat = 40
    private static let ember = UIColor(red: 220 / 255, green: 38 / 255, blue: 38 / 255, alpha: 1)
    private static let ink = UIColor(red: 22 / 255, green: 23 / 255, blue: 26 / 255, alpha: 1)
    private static let ink2 = UIColor(red: 92 / 255, green: 95 / 255, blue: 102 / 255, alpha: 1)
    private static let ink3 = UIColor(red: 138 / 255, green: 141 / 255, blue: 148 / 255, alpha: 1)
    private static let line = UIColor(red: 226 / 255, green: 228 / 255, blue: 232 / 255, alpha: 1)
    private static let zebra = UIColor(red: 246 / 255, green: 247 / 255, blue: 248 / 255, alpha: 1)
    private static let canvas = UIColor(red: 11 / 255, green: 11 / 255, blue: 12 / 255, alpha: 1)
    private static let headFill = UIColor(red: 240 / 255, green: 241 / 255, blue: 243 / 255, alpha: 1)
    private static let signatureInk = UIColor(red: 24 / 255, green: 38 / 255, blue: 84 / 255, alpha: 1)

    static func build(_ request: ReportRequest) async -> Data {
        let patrols = Array(request.session.patrols.reversed())
        var photos: [(patrol: Int, image: UIImage)] = []
        for (i, p) in patrols.enumerated() {
            for ref in p.photoRefs {
                if let img = await PhotoLoader.shared.image(for: ref) { photos.append((i + 1, img)) }
            }
        }
        let reportId = "PFW-\(Date().formatted(.dateTime.year(.twoDigits).month(.twoDigits).day(.twoDigits)))-\(String(request.property.id.prefix(4)).uppercased())"
        let crest = UIImage(named: "PhoenixCrest")

        let renderer = UIGraphicsPDFRenderer(bounds: page)
        return renderer.pdfData { ctx in
            var pageNumber = 0
            var y: CGFloat = 0

            func newPage() {
                ctx.beginPage()
                pageNumber += 1
                drawHeader(crest: crest, compact: pageNumber > 1)
                y = pageNumber > 1 ? 66 : 104
            }

            func ensure(_ height: CGFloat) {
                if y + height > page.height - 60 { newPage() }
            }

            newPage()

            // Title
            draw(request.property.name, at: CGPoint(x: margin, y: y), font: .systemFont(ofSize: 22, weight: .heavy), color: ink, width: page.width - margin * 2)
            y += 30
            if !request.property.address.isEmpty {
                draw(request.property.address, at: CGPoint(x: margin, y: y), font: .systemFont(ofSize: 11), color: ink2, width: page.width - margin * 2)
                y += 22
            }

            // Contact + watch period boxes
            let boxW = (page.width - margin * 2 - 14) / 2
            let officers = Array(Set(patrols.map(\.officerName))).sorted().joined(separator: ", ")
            infoBox(CGRect(x: margin, y: y, width: boxW, height: 88), title: "PROPERTY CONTACT", rows: [
                ("Contact", request.property.contactName.isEmpty ? "—" : request.property.contactName),
                ("Phone", request.property.contactPhone.isEmpty ? "—" : request.property.contactPhone),
                ("Email", request.property.contactEmail.isEmpty ? "—" : request.property.contactEmail),
            ])
            infoBox(CGRect(x: margin + boxW + 14, y: y, width: boxW, height: 88), title: "WATCH PERIOD", rows: [
                ("First patrol", Fmt.dateTime(request.session.start)),
                ("Last patrol", Fmt.dateTime(request.session.end)),
                ("Officers", officers.isEmpty ? "—" : officers),
            ])
            y += 104

            // Stat tiles
            let stats = PatrolStats(patrols)
            let tiles: [(String, Int, UIColor)] = [
                ("TOTAL PATROLS", stats.total, ember),
                ("CLEAR", stats.clear, PatrolStatus.clear.uiColor),
                ("FOLLOW-UP", stats.followUp, PatrolStatus.followUp.uiColor),
                ("INCIDENTS", stats.incidents, PatrolStatus.incident.uiColor),
            ]
            let tileW = (page.width - margin * 2 - 30) / 4
            for (i, t) in tiles.enumerated() {
                let r = CGRect(x: margin + CGFloat(i) * (tileW + 10), y: y, width: tileW, height: 56)
                roundedBox(r)
                t.2.setFill()
                UIRectFill(CGRect(x: r.minX, y: r.minY + 4, width: 3, height: r.height - 8))
                draw(t.0, at: CGPoint(x: r.minX + 12, y: r.minY + 10), font: .systemFont(ofSize: 7.5, weight: .semibold), color: ink3, width: tileW - 16, kern: 1.2)
                draw("\(t.1)", at: CGPoint(x: r.minX + 12, y: r.minY + 24), font: .systemFont(ofSize: 20, weight: .heavy), color: ink, width: tileW - 16)
            }
            y += 74

            // Patrol log
            sectionTitle("PATROL LOG", y: y)
            y += 24
            let cols: [(String, CGFloat)] = [("#", 22), ("Date / Time", 88), ("Officer", 84), ("Areas Patrolled", 128), ("Status", 64), ("Notes", 110), ("Photos", 36)]
            func tableHeader() {
                headFill.setFill()
                UIRectFill(CGRect(x: margin, y: y, width: page.width - margin * 2, height: 22))
                var x = margin + 6
                for c in cols {
                    draw(c.0, at: CGPoint(x: x, y: y + 6), font: .systemFont(ofSize: 8, weight: .bold), color: ink, width: c.1 - 6)
                    x += c.1
                }
                y += 22
            }
            tableHeader()
            let cellFont = UIFont.systemFont(ofSize: 8.5)
            for (i, p) in patrols.enumerated() {
                let values = [
                    "\(i + 1)",
                    "\(Fmt.day(p.dateTime))\n\(Fmt.time(p.dateTime))",
                    p.officerName,
                    p.areas.joined(separator: ", "),
                    p.status.label,
                    p.notes.isEmpty ? "—" : p.notes,
                    p.photoCount > 0 ? "\(p.photoCount)" : "—",
                ]
                let heights = zip(values, cols).map { v, c in height(of: v, font: cellFont, width: c.1 - 10) }
                let rowH = max(26, (heights.max() ?? 12) + 12)
                if y + rowH > page.height - 60 {
                    newPage()
                    tableHeader()
                }
                if i % 2 == 1 {
                    zebra.setFill()
                    UIRectFill(CGRect(x: margin, y: y, width: page.width - margin * 2, height: rowH))
                }
                var x = margin + 6
                for (j, c) in cols.enumerated() {
                    if j == 4 {
                        p.status.uiColor.setFill()
                        UIBezierPath(ovalIn: CGRect(x: x, y: y + 9, width: 6, height: 6)).fill()
                        draw(values[j], at: CGPoint(x: x + 10, y: y + 6), font: .systemFont(ofSize: 8.5, weight: .semibold), color: p.status.uiColor, width: c.1 - 14)
                    } else {
                        draw(values[j], at: CGPoint(x: x, y: y + 6), font: cellFont, color: j == 0 || j == 6 ? ink3 : ink, width: c.1 - 10)
                    }
                    x += c.1
                }
                y += rowH
                line.setFill()
                UIRectFill(CGRect(x: margin, y: y - 0.5, width: page.width - margin * 2, height: 0.5))
            }
            y += 22

            // Certification
            ensure(170)
            sectionTitle("CERTIFICATION", y: y)
            y += 24
            let cert = "By electronic signature below, the undersigned fire watch officer\(officers.contains(",") ? "s certify" : " certifies") that the fire watch patrols recorded in this report were conducted at \(request.property.name) as documented above, and that all observations are accurate and complete to the best of their knowledge."
            let certH = height(of: cert, font: .systemFont(ofSize: 9.5), width: page.width - margin * 2)
            draw(cert, at: CGPoint(x: margin, y: y), font: .systemFont(ofSize: 9.5), color: ink2, width: page.width - margin * 2)
            y += certH + 16

            let names = Array(Set(patrols.map(\.officerName))).sorted()
            let cardW = (page.width - margin * 2 - 14) / 2
            for (i, name) in names.enumerated() {
                if i % 2 == 0 { ensure(96) }
                let x = margin + CGFloat(i % 2) * (cardW + 14)
                let r = CGRect(x: x, y: y, width: cardW, height: 86)
                roundedBox(r)
                let script = UIFont(name: "GreatVibes-Regular", size: 26) ?? .italicSystemFont(ofSize: 22)
                draw(name, at: CGPoint(x: r.minX + 14, y: r.minY + 10), font: script, color: signatureInk, width: cardW - 100)
                let pill = CGRect(x: r.maxX - 82, y: r.minY + 10, width: 70, height: 16)
                ember.setStroke()
                let pillPath = UIBezierPath(roundedRect: pill, cornerRadius: 8)
                pillPath.lineWidth = 1
                pillPath.stroke()
                draw("✓ E-SIGNED", at: CGPoint(x: pill.minX + 9, y: pill.minY + 4), font: .systemFont(ofSize: 7, weight: .bold), color: ember, width: 60, kern: 0.8)
                ink3.setFill()
                UIRectFill(CGRect(x: r.minX + 14, y: r.minY + 46, width: cardW - 28, height: 0.6))
                draw(name, at: CGPoint(x: r.minX + 14, y: r.minY + 51), font: .systemFont(ofSize: 9.5, weight: .bold), color: ink, width: cardW - 120)
                draw("FIRE WATCH OFFICER", at: CGPoint(x: r.maxX - 108, y: r.minY + 52), font: .systemFont(ofSize: 7, weight: .medium), color: ink3, width: 100, kern: 1)
                let count = patrols.filter { $0.officerName == name }.count
                draw("Signed electronically \(Fmt.dateTime(Date())) · \(count) patrol\(count == 1 ? "" : "s")", at: CGPoint(x: r.minX + 14, y: r.minY + 67), font: .systemFont(ofSize: 7.5), color: ink3, width: cardW - 28)
                if i % 2 == 1 || i == names.count - 1 { y += 96 }
            }
            let footnote = "Electronic signatures applied by Phoenix Fire Watch from the officer names recorded on each patrol · Report \(reportId)" + (request.preparedBy.isEmpty ? "" : " · Prepared by \(request.preparedBy)\(request.orgName.isEmpty ? "" : ", \(request.orgName)")") + "."
            ensure(30)
            draw(footnote, at: CGPoint(x: margin, y: y + 4), font: .systemFont(ofSize: 7.5), color: ink3, width: page.width - margin * 2)

            // Photo pages
            if !photos.isEmpty {
                newPage()
                sectionTitle("PATROL PHOTOS", y: y)
                y += 26
                let cellW = (page.width - margin * 2 - 14) / 2
                let cellH: CGFloat = 250
                for (i, item) in photos.enumerated() {
                    if i % 2 == 0 && y + cellH > page.height - 60 {
                        newPage()
                    }
                    let x = margin + CGFloat(i % 2) * (cellW + 14)
                    let frame = CGRect(x: x, y: y, width: cellW, height: cellH - 22)
                    let img = item.image
                    let s = min(frame.width / img.size.width, frame.height / img.size.height)
                    let size = CGSize(width: img.size.width * s, height: img.size.height * s)
                    img.draw(in: CGRect(x: frame.midX - size.width / 2, y: frame.minY, width: size.width, height: size.height))
                    let p = patrols[item.patrol - 1]
                    draw("Patrol #\(item.patrol) · \(Fmt.dateTime(p.dateTime)) · \(p.officerName)", at: CGPoint(x: x, y: frame.minY + size.height + 5), font: .systemFont(ofSize: 7.5), color: ink2, width: cellW)
                    if i % 2 == 1 || i == photos.count - 1 { y += cellH + 10 }
                }
            }

            _ = pageNumber
        }
        .withPageFooters(reportId: reportId)
    }

    // MARK: - Drawing helpers

    /// White letterhead: brand mark + wordmark on the left, report title on the right, hairline rule with ember accent.
    private static func drawHeader(crest: UIImage?, compact: Bool) {
        let crestSize: CGFloat = compact ? 28 : 44
        let top: CGFloat = compact ? 10 : 18
        let chip = CGRect(x: margin, y: top, width: crestSize, height: crestSize)
        canvas.setFill()
        UIBezierPath(roundedRect: chip, cornerRadius: crestSize * 0.24).fill()
        crest?.draw(in: chip.insetBy(dx: crestSize * 0.08, dy: crestSize * 0.08))
        let tx = margin + crestSize + 12
        draw("PHOENIX", at: CGPoint(x: tx, y: top + (compact ? 1 : 4)), font: UIFont(name: "Georgia-Bold", size: compact ? 13 : 16) ?? .boldSystemFont(ofSize: 15), color: ink, width: 200, kern: 3)
        draw("FIRE WATCH", at: CGPoint(x: tx, y: top + (compact ? 17 : 23)), font: .systemFont(ofSize: compact ? 6.5 : 7.5, weight: .semibold), color: ember, width: 200, kern: 3)
        let title = "FIRE WATCH SHIFT REPORT"
        let font = UIFont.systemFont(ofSize: compact ? 8 : 10.5, weight: .bold)
        let w = (title as NSString).size(withAttributes: [.font: font, .kern: 1.5]).width
        draw(title, at: CGPoint(x: page.width - margin - w, y: top + (compact ? 3 : 7)), font: font, color: ink, width: w + 4, kern: 1.5)
        let ry: CGFloat = compact ? 46 : 72
        line.setFill()
        UIRectFill(CGRect(x: margin, y: ry, width: page.width - margin * 2, height: 0.8))
        ember.setFill()
        UIRectFill(CGRect(x: margin, y: ry - 0.5, width: 52, height: 1.8))
    }

    private static func sectionTitle(_ text: String, y: CGFloat) {
        ember.setFill()
        UIRectFill(CGRect(x: margin, y: y + 1, width: 3, height: 13))
        draw(text, at: CGPoint(x: margin + 10, y: y), font: .systemFont(ofSize: 11, weight: .heavy), color: ink, width: 300, kern: 1.8)
    }

    private static func roundedBox(_ r: CGRect) {
        let path = UIBezierPath(roundedRect: r, cornerRadius: 6)
        UIColor(white: 0.985, alpha: 1).setFill()
        path.fill()
        line.setStroke()
        path.lineWidth = 0.8
        path.stroke()
    }

    private static func infoBox(_ r: CGRect, title: String, rows: [(String, String)]) {
        roundedBox(r)
        draw(title, at: CGPoint(x: r.minX + 12, y: r.minY + 10), font: .systemFont(ofSize: 7.5, weight: .bold), color: ember, width: r.width - 24, kern: 1.4)
        for (i, row) in rows.enumerated() {
            let ry = r.minY + 28 + CGFloat(i) * 18
            draw(row.0, at: CGPoint(x: r.minX + 12, y: ry), font: .systemFont(ofSize: 8.5), color: ink3, width: 70)
            draw(row.1, at: CGPoint(x: r.minX + 84, y: ry), font: .systemFont(ofSize: 8.5, weight: .semibold), color: ink, width: r.width - 96, lines: 1)
        }
    }

    private static func height(of text: String, font: UIFont, width: CGFloat) -> CGFloat {
        let rect = (text as NSString).boundingRect(
            with: CGSize(width: width, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: [.font: font],
            context: nil
        )
        return ceil(rect.height)
    }

    private static func draw(_ text: String, at point: CGPoint, font: UIFont, color: UIColor, width: CGFloat, kern: CGFloat = 0, lines: Int = 0) {
        let style = NSMutableParagraphStyle()
        style.lineBreakMode = lines == 1 ? .byTruncatingTail : .byWordWrapping
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .kern: kern, .paragraphStyle: style]
        let h = lines == 1 ? font.lineHeight + 2 : height(of: text, font: font, width: width) + 2
        (text as NSString).draw(with: CGRect(x: point.x, y: point.y, width: width, height: h), options: [.usesLineFragmentOrigin, .usesFontLeading, .truncatesLastVisibleLine], attributes: attrs, context: nil)
    }
}

private extension Data {
    /// Stamps "Page x of y" footers onto every page of a rendered PDF.
    func withPageFooters(reportId: String) -> Data {
        guard let provider = CGDataProvider(data: self as CFData), let doc = CGPDFDocument(provider) else { return self }
        let count = doc.numberOfPages
        let out = NSMutableData()
        var box = CGRect(x: 0, y: 0, width: 612, height: 792)
        guard let consumer = CGDataConsumer(data: out as CFMutableData), let ctx = CGContext(consumer: consumer, mediaBox: &box, nil) else { return self }
        for i in 1...Swift.max(1, count) {
            guard let pdfPage = doc.page(at: i) else { continue }
            var media = pdfPage.getBoxRect(.mediaBox)
            ctx.beginPage(mediaBox: &media)
            ctx.drawPDFPage(pdfPage)
            UIGraphicsPushContext(ctx)
            ctx.saveGState()
            ctx.translateBy(x: 0, y: media.height)
            ctx.scaleBy(x: 1, y: -1)
            let color = UIColor(red: 138 / 255, green: 141 / 255, blue: 148 / 255, alpha: 1)
            UIColor(red: 226 / 255, green: 228 / 255, blue: 232 / 255, alpha: 1).setFill()
            UIRectFill(CGRect(x: 40, y: media.height - 42, width: media.width - 80, height: 0.6))
            let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 7.5), .foregroundColor: color]
            ("Phoenix Fire Watch  ·  Fire Watch Shift Report  ·  \(reportId)" as NSString).draw(at: CGPoint(x: 40, y: media.height - 34), withAttributes: attrs)
            ("Confidential" as NSString).draw(at: CGPoint(x: media.width / 2 + 40, y: media.height - 34), withAttributes: attrs)
            let label = "Page \(i) of \(count)" as NSString
            let w = label.size(withAttributes: attrs).width
            label.draw(at: CGPoint(x: media.width - 40 - w, y: media.height - 34), withAttributes: attrs)
            ctx.restoreGState()
            UIGraphicsPopContext()
            ctx.endPage()
        }
        ctx.closePDF()
        return out as Data
    }
}
