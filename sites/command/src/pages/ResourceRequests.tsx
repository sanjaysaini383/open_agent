import { Link } from "react-router-dom";
import { ExternalLink, Inbox } from "lucide-react";
import { AssessmentView } from "@/components/views";
import { Badge, Button, Card, CardHeader, Empty, PageHeader, Table, Td, Th, UrgencyBadge, time } from "@/components/ui";
import { num, RESOURCES } from "@/domain/resources";
import type { ResourceId, Urgency } from "@/domain/types";
import { useActiveIncident, useStore } from "@/state/store";
import type { AssistanceRequest } from "@/state/types";
import { useUi } from "@/state/ui";
import { runStep } from "@/workflow/steps";

export function ResourceRequestsPage() {
  const incident = useActiveIncident();
  const inbox = useStore((state) => state.inbox);
  const shelter = useStore((state) => Object.values(state.peers).find((peer) => peer.role === "shelter"));
  const busy = useUi((state) => state.busyIncident);

  const refresh = async () => {
    if (!incident || useUi.getState().busyIncident) return;
    useUi.getState().setBusy(incident.id);
    try {
      const outcome = await runStep(incident.id, "assess");
      useUi.getState().notify(outcome.ok ? outcome.summary : outcome.reason || "Not refreshed.", outcome.ok ? "ok" : "warn");
    } finally { useUi.getState().setBusy(null); }
  };
  const decide = async (request: AssistanceRequest, status: AssistanceRequest["status"]) => {
    const store = useStore.getState();
    store.setInboxStatus(request.reference, status);
    await store.record({ kind: "incident", actor: "human:coordinator", incidentId: store.activeIncidentId, summary: `Assistance request ${request.reference} ${status}`, data: { organization: request.organization, callerOrigin: request.callerOrigin } });
  };

  return (
    <>
      <PageHeader
        title="Resource Requests"
        subtitle="What each shelter needs, what it has, and what the plan allocates. Shelters publish their own requests on ShelterConnect; this site reads them, with your consent, and never edits them."
        actions={<>
          {shelter && <a href={shelter.siteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3.5 py-2 text-[13.5px] font-semibold text-ink-2 hover:bg-surface-2"><ExternalLink size={14} aria-hidden />Publish a request on {shelter.label}</a>}
          <Button variant="primary" disabled={!incident || !!busy || incident.status === "closed"} busy={!!incident && busy === incident.id} onClick={refresh}>Read requests again</Button>
        </>}
      />

      <Card>
        <CardHeader title={incident ? `Shelter requests — ${incident.name}` : "Shelter requests"} subtitle={incident ? <>From the needs assessment of <Link className="underline" to={`/incidents/${incident.id}`}>{incident.id}</Link>. Re-reading replaces the assessment and clears the plan built on it.</> : undefined} />
        {incident ? <AssessmentView incidentId={incident.id} /> : <Empty title="No active incident">Open an incident first.</Empty>}
      </Card>

      <div className="mt-5">
        <Card>
          <CardHeader
            icon={<Inbox size={16} aria-hidden />}
            title="Assistance requests from partner sites"
            subtitle="Any compatible agentic website can call this site's request_assistance action. It opens a ReliefMesh window, where a person confirms the request; only then does it appear here. Filing a request orders nothing."
          />
          {inbox.length ? (
            <Table label="Assistance requests">
              <thead><tr><Th>Reference</Th><Th>Organisation</Th><Th>Category</Th><Th>Urgency</Th><Th>Request</Th><Th>Asked from</Th><Th>Received</Th><Th>Status</Th></tr></thead>
              <tbody>
                {inbox.slice().reverse().map((request) => (
                  <tr key={request.reference}>
                    <Td className="font-mono text-[12px]">{request.reference}</Td>
                    <Td className="font-medium">{request.organization}</Td>
                    <Td><span className="capitalize">{request.category}</span></Td>
                    <Td><UrgencyBadge urgency={(["low", "medium", "high", "critical"].includes(request.urgency) ? request.urgency : "medium") as Urgency} /></Td>
                    <Td>{request.summary}{request.resource && request.quantity ? <div className="text-[11.5px] text-muted">{num(request.quantity)} × {RESOURCES[request.resource as ResourceId]?.label ?? request.resource}</div> : null}</Td>
                    <Td className="font-mono text-[11.5px]">{request.callerOrigin || "—"}</Td>
                    <Td>{time(request.receivedAt)}</Td>
                    <Td>
                      {request.status === "new"
                        ? <div className="flex flex-wrap gap-1"><Button size="sm" variant="primary" onClick={() => decide(request, "acknowledged")}>Acknowledge</Button><Button size="sm" variant="ghost" onClick={() => decide(request, "dismissed")}>Dismiss</Button></div>
                        : <Badge tone={request.status === "acknowledged" ? "ok" : "neutral"}><span className="capitalize">{request.status}</span></Badge>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <Empty title="No assistance requests">When a partner site's agent files one and a person confirms it, it appears here. Try it from ShelterConnect's assistant: “Can ReliefMesh coordinate suppliers for our open requests?”</Empty>}
        </Card>
      </div>
    </>
  );
}
