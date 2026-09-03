"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function MySalaryPage() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient();
        await supabase.auth.getUser();
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-sm text-muted-foreground">
          Loading salary...
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">My Salary</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Salary details will appear here.
        </p>
      </div>
    </div>
  );
}