import { Flame } from "lucide-react";
import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NotFound = ({ embedded = false }: { embedded?: boolean }) => {
  const location = useLocation();

  useEffect(() => {
    console.warn("404: route not found", location.pathname);
  }, [location.pathname]);

  return (
    <div className={cn("flex items-center justify-center px-4", embedded ? "min-h-[60vh]" : "canvas-glow min-h-screen")}>
      <div className="text-center">
        <Flame className="mx-auto h-12 w-12 text-link" strokeWidth={1.5} />
        <h1 className="mt-5 font-display text-4xl font-extrabold text-ink">Not found</h1>
        <p className="mt-2 text-ink-2">This page or record doesn't exist anymore.</p>
        <Button asChild className="mt-7">
          <Link to="/">Return to Dashboard</Link>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
