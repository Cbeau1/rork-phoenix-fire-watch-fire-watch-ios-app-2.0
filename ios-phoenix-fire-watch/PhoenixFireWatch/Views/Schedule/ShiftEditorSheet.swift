import SwiftUI

/// What the editor opens with: an existing shift, or defaults for a new one.
struct ShiftDraft: Identifiable {
    let id = UUID()
    var shift: Shift?
    var date: String?
    var propertyId: String?
}

/// Admin sheet to add shifts (one or many days at once) or edit / delete a shift.
struct ShiftEditorSheet: View {
    let draft: ShiftDraft
    let days: [Date]

    @Environment(\.dismiss) private var dismiss
    @Environment(ScheduleStore.self) private var schedule
    @Environment(FireWatchStore.self) private var store
    @Environment(AppRouter.self) private var router

    @State private var staffId: String = ""
    @State private var propertyId: String = ""
    @State private var selectedDays: Set<String> = []
    @State private var start: String = "07:00"
    @State private var end: String = "19:00"
    @State private var notes: String = ""
    @State private var addingName: Bool = false
    @State private var newName: String = ""
    @State private var busy: Bool = false
    @State private var error: String?
    @State private var confirmDelete: Bool = false
    @State private var didLoad: Bool = false

    private var isEditing: Bool { draft.shift != nil }
    private var dayKeys: [String] { days.map(ScheduleDates.key) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let error { ErrorBanner(message: error) }
                    staffSection
                    propertySection
                    daysSection
                    timeSection
                    notesSection
                    Button {
                        Task { await save() }
                    } label: {
                        if busy { ProgressView().tint(.white) } else { Text(saveTitle) }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy)
                    if isEditing {
                        Button("Delete Shift", role: .destructive) { confirmDelete = true }
                            .buttonStyle(OutlineButtonStyle(tint: .fwIncident))
                            .disabled(busy)
                    }
                }
                .padding(16)
                .animation(.spring(response: 0.35, dampingFraction: 0.85), value: addingName)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color.fwCanvas)
            .navigationTitle(isEditing ? "Edit Shift" : "Add Shift")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .confirmationDialog("Delete this shift?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete Shift", role: .destructive) { Task { await delete() } }
            } message: {
                Text("It's removed from everyone's schedule, along with its pay status.")
            }
            .onAppear(perform: load)
        }
    }

    private var saveTitle: String {
        if isEditing { return "Save Changes" }
        return selectedDays.count > 1 ? "Add \(selectedDays.count) Shifts" : "Add Shift"
    }

    // MARK: - Sections

    private var staffSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            fieldLabel("Staff", required: true)
            if addingName {
                HStack(spacing: 8) {
                    TextField("", text: $newName, prompt: Text("Full name").foregroundStyle(Color.fwInk3))
                        .textInputAutocapitalization(.words)
                        .textContentType(.name)
                        .foregroundStyle(Color.fwInk)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 50)
                        .background(Color.fwField, in: .rect(cornerRadius: 11))
                        .overlay { RoundedRectangle(cornerRadius: 11).strokeBorder(Color.fwLink, lineWidth: 1) }
                        .submitLabel(.done)
                        .onSubmit { Task { await addName() } }
                    Button("Add") { Task { await addName() } }
                        .buttonStyle(PrimaryButtonStyle(fullWidth: false, compact: true))
                        .disabled(newName.trimmed.isEmpty || busy)
                }
                Button("Pick an existing name instead") { addingName = false }
                    .font(.system(.footnote, weight: .semibold))
                    .disabled(schedule.staff.isEmpty)
            } else {
                Menu {
                    ForEach(schedule.staff) { s in
                        Button {
                            staffId = s.id
                        } label: {
                            if s.id == staffId { Label(s.name, systemImage: "checkmark") } else { Text(s.name) }
                        }
                    }
                    Divider()
                    Button {
                        newName = ""
                        addingName = true
                    } label: {
                        Label("Add a new name…", systemImage: "person.badge.plus")
                    }
                } label: {
                    pickerLabel(schedule.staff(id: staffId)?.name, placeholder: "Choose a person", symbol: "person.fill")
                }
            }
        }
    }

    private var propertySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            fieldLabel("Property", required: true)
            Menu {
                ForEach(store.properties) { p in
                    Button {
                        propertyId = p.id
                    } label: {
                        if p.id == propertyId { Label(p.name, systemImage: "checkmark") } else { Text(p.name) }
                    }
                }
            } label: {
                pickerLabel(store.property(id: propertyId)?.name, placeholder: "Choose a property", symbol: "building.2.fill")
            }
        }
    }

    private var daysSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                fieldLabel(isEditing ? "Day" : "Days", required: true)
                Spacer()
                if !isEditing {
                    Button(selectedDays.count == 7 ? "Clear" : "Every day") {
                        selectedDays = selectedDays.count == 7 ? [] : Set(dayKeys)
                    }
                    .font(.system(.footnote, weight: .semibold))
                }
            }
            HStack(spacing: 6) {
                ForEach(days, id: \.self) { day in
                    dayButton(day)
                }
            }
            if !isEditing {
                Text("Pick several days to repeat this shift across the week.")
                    .font(.caption)
                    .foregroundStyle(Color.fwInk3)
            }
        }
    }

    private func dayButton(_ day: Date) -> some View {
        let key = ScheduleDates.key(day)
        let on = selectedDays.contains(key)
        let today = Calendar.current.isDateInToday(day)
        return Button {
            if isEditing {
                selectedDays = [key]
            } else if on {
                selectedDays.remove(key)
            } else {
                selectedDays.insert(key)
            }
        } label: {
            VStack(spacing: 3) {
                Text(day.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                    .font(.system(size: 10, weight: .bold))
                    .tracking(0.5)
                Text(day.formatted(.dateTime.day()))
                    .font(.system(.headline, weight: .heavy))
                    .monospacedDigit()
            }
            .foregroundStyle(on ? Color.white : today ? Color.fwLink : Color.fwInk2)
            .frame(maxWidth: .infinity, minHeight: 58)
            .background(on ? Color.fwPrimary : Color.fwRaised, in: .rect(cornerRadius: 11))
            .overlay {
                RoundedRectangle(cornerRadius: 11)
                    .strokeBorder(on ? Color.clear : today ? Color.fwPrimary.opacity(0.5) : Color.fwLineStrong, lineWidth: 1)
            }
        }
        .buttonStyle(PressableStyle())
        .sensoryFeedback(.selection, trigger: on)
        .accessibilityLabel(day.formatted(.dateTime.weekday(.wide).month().day()))
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private var timeSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            fieldLabel("Time", required: true)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(ShiftPreset.all) { preset in
                        let on = preset.start == start && preset.end == end
                        Button {
                            start = preset.start
                            end = preset.end
                        } label: {
                            VStack(spacing: 2) {
                                Text(preset.label).font(.system(.subheadline, weight: .bold))
                                Text(ScheduleDates.range(start: preset.start, end: preset.end))
                                    .font(FWFont.mono(.caption2))
                                    .foregroundStyle(on ? Color.fwLink : Color.fwInk3)
                            }
                            .foregroundStyle(on ? Color.fwLink : Color.fwInk)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 50)
                            .background(on ? Color.fwPrimary.opacity(0.14) : Color.fwRaised, in: .rect(cornerRadius: 11))
                            .overlay {
                                RoundedRectangle(cornerRadius: 11)
                                    .strokeBorder(on ? Color.fwPrimary.opacity(0.6) : Color.fwLineStrong, lineWidth: 1)
                            }
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
            }
            .scrollClipDisabled()
            HStack(spacing: 10) {
                timePicker("Start", value: $start)
                Image(systemName: "arrow.right").font(.caption.weight(.bold)).foregroundStyle(Color.fwInk3)
                timePicker("End", value: $end)
            }
            HStack(spacing: 6) {
                if ScheduleDates.isOvernight(start: start, end: end) && start != end {
                    Image(systemName: "moon.fill").font(.caption2).foregroundStyle(Color.fwSilver)
                    Text("Overnight · ends the next morning")
                } else {
                    Image(systemName: "clock").font(.caption2)
                    Text(start == end ? "Start and end can't be the same" : "Same-day shift")
                }
                Spacer()
                if start != end {
                    Text(ScheduleDates.hours(ScheduleDates.duration(start: start, end: end)))
                        .font(FWFont.mono(.caption, weight: .bold))
                        .foregroundStyle(Color.fwInk)
                }
            }
            .font(.caption)
            .foregroundStyle(start == end ? Color.fwIncidentInk : Color.fwInk3)
        }
    }

    private func timePicker(_ title: String, value: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased()).font(FWFont.label).tracking(1.2).foregroundStyle(Color.fwInk3)
            DatePicker(
                title,
                selection: Binding(
                    get: { ScheduleDates.date(fromHHMM: value.wrappedValue) },
                    set: { value.wrappedValue = ScheduleDates.hhmm(from: $0) }
                ),
                displayedComponents: .hourAndMinute
            )
            .labelsHidden()
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.fwRaised, in: .rect(cornerRadius: 11))
        .overlay { RoundedRectangle(cornerRadius: 11).strokeBorder(Color.fwLineStrong, lineWidth: 1) }
    }

    private var notesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            fieldLabel("Notes", required: false)
            TextField("", text: $notes, prompt: Text("Post orders, gate code, relief officer…").foregroundStyle(Color.fwInk3), axis: .vertical)
                .lineLimit(2...5)
                .foregroundStyle(Color.fwInk)
                .padding(14)
                .background(Color.fwField, in: .rect(cornerRadius: 11))
                .overlay { RoundedRectangle(cornerRadius: 11).strokeBorder(Color.fwLineStrong, lineWidth: 1) }
        }
    }

    private func fieldLabel(_ text: String, required: Bool) -> some View {
        HStack(spacing: 2) {
            Text(text).font(.system(.subheadline, weight: .medium)).foregroundStyle(Color.fwInk)
            if required { Text("*").foregroundStyle(Color.fwLink) }
        }
    }

    private func pickerLabel(_ value: String?, placeholder: String, symbol: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).font(.subheadline).foregroundStyle(value == nil ? Color.fwInk3 : Color.fwLink).frame(width: 20)
            Text(value ?? placeholder)
                .foregroundStyle(value == nil ? Color.fwInk3 : Color.fwInk)
                .lineLimit(1)
            Spacer()
            Image(systemName: "chevron.up.chevron.down").font(.caption).foregroundStyle(Color.fwInk3)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 50)
        .background(Color.fwRaised, in: .rect(cornerRadius: 11))
        .overlay { RoundedRectangle(cornerRadius: 11).strokeBorder(Color.fwLineStrong, lineWidth: 1) }
        .contentShape(.rect)
    }

    // MARK: - Actions

    private func load() {
        guard !didLoad else { return }
        didLoad = true
        if let s = draft.shift {
            staffId = s.staffId
            propertyId = s.propertyId
            selectedDays = [s.date]
            start = s.start
            end = s.end
            notes = s.notes
        } else {
            propertyId = draft.propertyId ?? (store.properties.count == 1 ? store.properties[0].id : "")
            if let date = draft.date { selectedDays = [date] }
            addingName = schedule.staff.isEmpty
        }
    }

    private func addName() async {
        let name = newName.trimmed
        guard !name.isEmpty else { return }
        busy = true
        defer { busy = false }
        do {
            let created = try await schedule.addStaff(name: name, profileId: nil)
            staffId = created.id
            addingName = false
            newName = ""
            error = nil
        } catch {
            self.error = ErrorText.from(error)
        }
    }

    private func save() async {
        if addingName && !newName.trimmed.isEmpty { await addName() }
        guard schedule.staff(id: staffId) != nil else { error = "Choose who's working this shift."; return }
        guard store.property(id: propertyId) != nil else { error = "Choose a property."; return }
        guard !selectedDays.isEmpty else { error = "Pick at least one day."; return }
        guard start != end else { error = "Start and end time can't be the same."; return }
        let input = ShiftInput(staffId: staffId, propertyId: propertyId, start: start, end: end, notes: notes)
        busy = true
        defer { busy = false }
        do {
            if let shift = draft.shift {
                try await schedule.updateShift(id: shift.id, date: selectedDays.first ?? shift.date, input: input)
                router.show("Shift updated")
            } else {
                let dates = selectedDays.sorted()
                try await schedule.addShifts(input, dates: dates)
                router.show(dates.count == 1 ? "Shift added" : "\(dates.count) shifts added")
            }
            dismiss()
        } catch {
            self.error = ErrorText.from(error)
        }
    }

    private func delete() async {
        guard let shift = draft.shift else { return }
        busy = true
        defer { busy = false }
        do {
            try await schedule.deleteShift(id: shift.id)
            router.show("Shift deleted")
            dismiss()
        } catch {
            self.error = ErrorText.from(error)
        }
    }
}
