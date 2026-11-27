import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, ShieldCheck } from "lucide-react";
import { Collapse } from "@/components/motion";
import { Badge, Button, Card, CardHeader, Empty, Notice, PageHeader, Pagination, SearchInput, SortableTh, Td, Th, inputClass, time, usePagination, useSort } from "@/components/ui";
import { verifyChain } from "@/domain/audit";
import type { AuditEntry, AuditKind } from "@/domain/types";
import { exportAudit } from "@/lib/export";
import { useStore } from "@/state/store";

const KIND_TONE: Partial<Record<AuditKind, "ok" | "warn" | "critical" | "info" | "navy" | "neutral">> = {
  approval: "warn", execution: "ok", consent: "info", security: "critical", trust: "navy", network: "info",
};
const PAGE_SIZE = 50;
const ACCESSORS = { seq: (entry: AuditEntry) => entry.seq, at: (entry: AuditEntry) => entry.at, kind: (entry: AuditEntry) => entry.kind, actor: (entry: AuditEntry) => entry.actor };

function Row({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr>
        <Td right>{entry.seq}</Td>
        <Td className="whitespace-nowrap">{time(entry.at)}</Td>
        <Td><Badge tone={KIND_TONE[entry.kind] ?? "neutral"}>{entry.kind}</Badge></Td>
        <Td className="font-mono text-[12px]">{entry.actor}</Td>
        <Td>{entry.summary}{entry.incidentId && <span className="ml-1.5 font-mono text-[11.5px] text-muted">{entry.incidentId}</span>}</Td>
        <Td><Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}Details</Button></Td>
      </tr>
      {open && (
        <tr><Td colSpan={6} className="bg-surface-2">
          <Collapse open={open}>
            <pre className="scroll-thin max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px]">{JSON.stringify(entry.data, null, 2)}</pre>
            <p className="mt-2 break-all font-mono text-[11px] text-muted">prev {entry.prevHash}<br />hash {entry.hash}</p>
          </Collapse>
        </Td></tr>
      )}
    </>
  );
}

export function AuditTrailPage() {
  const audit = useStore((state) => state.audit);
  const incidents = useStore((state) => state.incidents);
  const [kind, setKind] = useState<AuditKind | "all">("all");
  const [incident, setIncident] = useState("all");
  const [query, setQuery] = useState("");
  const [chain, setChain] = useState<{ valid: boolean; checked: number; reason: string } | null>(null);

  useEffect(() => { let live = true; void verifyChain(audit).then((result) => { if (live) setChain(result); }); return () => { live = false; }; }, [audit]);

  const kinds = useMemo(() => [...new Set(audit.map((entry) => entry.kind))].sort(), [audit]);
  const filtered = useMemo(() => audit.filter((entry) =>
    (kind === "all" || entry.kind === kind)
    && (incident === "all" || entry.incidentId === incident)
    && (!query.trim() || `${entry.summary} ${entry.actor}`.toLowerCase().includes(query.trim().toLowerCase())),
  ), [audit, kind, incident, query]);
  const [sorted, sort, setSort] = useSort<AuditEntry, keyof typeof ACCESSORS>(filtered, ACCESSORS, { key: "seq", dir: "desc" });
  const pages = usePagination(sorted, PAGE_SIZE);

  return (
    <>
      <PageHeader
        eyebrow="Tamper-evident log"
        title="Audit Trail"
        subtitle="Every consent decision, agent action, trust check, human approval and external receipt, in order. Each entry carries the hash of the one before it, so an altered, removed or reordered entry is detectable."
        actions={<>
          <Button onClick={() => exportAudit(audit, "json")} disabled={!audit.length}><Download size={13} aria-hidden />Export JSON</Button>
          <Button onClick={() => exportAudit(audit, "csv")} disabled={!audit.length}><Download size={13} aria-hidden />Export CSV</Button>
        </>}
      />
      <div className="grid gap-5">
        {chain && (
          <Notice tone={chain.valid ? "ok" : "critical"} title={chain.valid ? "Hash chain intact" : "Hash chain broken"}>
            <span className="inline-flex items-start gap-1.5"><ShieldCheck size={15} className="mt-0.5 shrink-0" aria-hidden />{chain.reason} The chain is recomputed with SHA-256 each time this page opens. It shows the log was not altered after it was written in this browser; it is not a signature and does not prove who wrote it.</span>
          </Notice>
        )}
        <Card>
          <CardHeader title={`${filtered.length} of ${audit.length} entries`} subtitle="Credentials are never written to the log: anything shaped like a key is redacted before an entry is hashed." />
          <div className="mb-3 grid gap-2 md:grid-cols-[180px_220px_1fr]">
            <select className={inputClass} value={kind} onChange={(event) => { setKind(event.target.value as AuditKind | "all"); pages.setPage(1); }} aria-label="Filter by kind">
              <option value="all">All kinds</option>{kinds.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select className={inputClass} value={incident} onChange={(event) => { setIncident(event.target.value); pages.setPage(1); }} aria-label="Filter by incident">
              <option value="all">All incidents</option>{incidents.map((item) => <option key={item.id} value={item.id}>{item.id} — {item.name}</option>)}
            </select>
            <SearchInput value={query} onChange={(value) => { setQuery(value); pages.setPage(1); }} placeholder="Search summaries and actors" label="Search" />
          </div>
          {pages.rows.length ? (
            <div className="scroll-thin overflow-x-auto rounded-lg border border-line">
              <table aria-label="Audit entries" className="w-full border-collapse [&_tbody_tr:last-child_td]:border-b-0">
                <thead><tr><SortableTh sortKey="seq" sort={sort} onSort={setSort} right>Seq</SortableTh><SortableTh sortKey="at" sort={sort} onSort={setSort}>Time</SortableTh><SortableTh sortKey="kind" sort={sort} onSort={setSort}>Kind</SortableTh><SortableTh sortKey="actor" sort={sort} onSort={setSort}>Actor</SortableTh><Th>Summary</Th><Th /></tr></thead>
                <tbody>{pages.rows.map((entry) => <Row key={entry.seq} entry={entry} />)}</tbody>
              </table>
            </div>
          ) : <Empty title={audit.length ? "No entry matches the filters" : "The audit trail is empty"}>{audit.length ? "Clear a filter to see more." : "Entries appear as soon as the workflow starts or a consent decision is made."}</Empty>}
          <Pagination page={pages.page} pages={pages.pages} onChange={pages.setPage} total={sorted.length} pageSize={PAGE_SIZE} />
        </Card>
      </div>
    </>
  );
}
