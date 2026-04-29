"use client";

import { useEffect, useId, useState } from "react";

export interface ModelItem {
  id: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  label: string;
  filter?: (id: string) => boolean;
  placeholder?: string;
}

export function ModelPicker({ value, onChange, label, filter, placeholder }: Props) {
  const listId = useId();
  const [models, setModels] = useState<ModelItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((j) => {
        const list = (j?.data ?? []) as ModelItem[];
        setModels(filter ? list.filter((m) => filter(m.id)) : list);
      })
      .finally(() => setLoading(false));
  }, [filter]);

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground whitespace-nowrap">{label}</span>
      <input
        type="text"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={loading ? "加载中…" : placeholder ?? "从列表选择或手动键入"}
        autoComplete="off"
        spellCheck={false}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm min-w-[220px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <datalist id={listId}>
        {models.map((m) => (
          <option key={m.id} value={m.id} />
        ))}
      </datalist>
    </label>
  );
}
