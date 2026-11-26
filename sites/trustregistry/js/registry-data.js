// TrustRegistry seed data.
//
// SIMULATED DEMONSTRATION DATA. The registry's authority, every record, every credential,
// every reputation figure and every report below is invented for the ReliefMesh
// demonstration. No real organisation, licence or regulator is described. What is real is
// the cryptography: the registry signs its statements with ECDSA P-256 and any caller can
// verify them (see js/canonical.js and scripts/sign-trust.mjs).
//
// This module has no browser dependency, so scripts/sign-trust.mjs and the Node tests
// import it directly.

export class RegistryData {
  static NOTICE = "Simulated demonstration data. The registry's authority, records and credentials are invented; only its signatures are real.";

  static REGISTRY_NAME = "TrustRegistry (demonstration)";
  static ALGORITHM = "ECDSA-P256-SHA256";

  /** Statuses a registry operator can set. "pending" is only ever assigned by the registry. */
  static STATUSES = ["active", "suspended", "revoked"];

  /** How bad a status is. A caller takes the worse of the live and the attested status. */
  static SEVERITY = { active: 0, pending: 1, suspended: 2, revoked: 3 };

  static REPORT_REASONS = {
    price_anomaly: "Price anomaly",
    identity_mismatch: "Identity mismatch",
    unverifiable_address: "Unverifiable address",
    instruction_injection: "Instruction injection",
    non_delivery: "Non-delivery",
    other: "Other",
  };

  static ORGANIZATION_TYPES = ["ngo", "commercial", "cooperative", "union", "other"];

  /** How long a signed attestation stays valid. */
  static ATTESTATION_DAYS = 180;

  /**
   * Credentials the (simulated) issuer withdrew, by credential id, with the date. A signed
   * credential has only type, issuer, id, validFrom and validUntil, so a withdrawn one
   * carries its withdrawal date as validUntil and is listed here to be shown as revoked.
   */
  static REVOKED_CREDENTIALS = {
    "SIM-GCP-TR3-2025": "2026-10-12",
  };

  static AGENT_NETWORKS = [
    {
      subjectId: "net:reliefmesh_command",
      network: "reliefmesh_command",
      name: "ReliefMesh Command",
      operator: "ReliefMesh Coordination Cell (simulated)",
      status: "active",
      registeredAt: "2026-03-02",
      credentials: [
        { type: "Agent operator registration (simulated)", issuer: "TrustRegistry (demonstration)", id: "SIM-AOR-0001", validFrom: "2026-03-02", validUntil: "2027-03-01" },
      ],
      reputation: {
        completed: 8, disputes: 0, fulfilmentRate: 1, lastActivity: "2026-11-09",
        history: [
          { date: "2026-11-09", event: "Coordinated a simulated cyclone drill across three partner networks", outcome: "completed" },
          { date: "2026-09-21", event: "Coordinated a simulated flood exercise", outcome: "completed" },
          { date: "2026-06-14", event: "Annual operator review", outcome: "passed" },
        ],
      },
    },
    {
      subjectId: "net:shelterconnect",
      network: "shelterconnect",
      name: "ShelterConnect",
      operator: "ShelterConnect (demonstration)",
      status: "active",
      registeredAt: "2026-03-05",
      credentials: [
        { type: "Agent operator registration (simulated)", issuer: "TrustRegistry (demonstration)", id: "SIM-AOR-0002", validFrom: "2026-03-05", validUntil: "2027-03-04" },
      ],
      reputation: {
        completed: 21, disputes: 0, fulfilmentRate: 0.99, lastActivity: "2026-11-12",
        history: [
          { date: "2026-11-12", event: "Published shelter requests during a simulated drill", outcome: "completed" },
          { date: "2026-10-03", event: "Delivery receipts reconciled against shipments", outcome: "completed" },
          { date: "2026-07-19", event: "Annual operator review", outcome: "passed" },
        ],
      },
    },
    {
      subjectId: "net:aidsupply",
      network: "aidsupply",
      name: "AidSupply Network",
      operator: "AidSupply Network (demonstration)",
      status: "active",
      registeredAt: "2026-03-09",
      credentials: [
        { type: "Agent operator registration (simulated)", issuer: "TrustRegistry (demonstration)", id: "SIM-AOR-0003", validFrom: "2026-03-09", validUntil: "2027-03-08" },
      ],
      reputation: {
        completed: 17, disputes: 1, fulfilmentRate: 0.96, lastActivity: "2026-11-10",
        history: [
          { date: "2026-11-10", event: "Supplier offers served to a coordinating network", outcome: "completed" },
          { date: "2026-08-27", event: "Dispute over a late listing update", outcome: "resolved" },
          { date: "2026-07-02", event: "Annual operator review", outcome: "passed" },
        ],
      },
    },
    {
      subjectId: "net:routebridge",
      network: "routebridge",
      name: "RouteBridge",
      operator: "RouteBridge (demonstration)",
      status: "active",
      registeredAt: "2026-03-11",
      credentials: [
        { type: "Agent operator registration (simulated)", issuer: "TrustRegistry (demonstration)", id: "SIM-AOR-0004", validFrom: "2026-03-11", validUntil: "2027-03-10" },
      ],
      reputation: {
        completed: 19, disputes: 1, fulfilmentRate: 0.95, lastActivity: "2026-11-11",
        history: [
          { date: "2026-11-11", event: "Transport options served during a simulated drill", outcome: "completed" },
          { date: "2026-09-08", event: "Dispute over an arrival estimate", outcome: "resolved" },
          { date: "2026-07-25", event: "Annual operator review", outcome: "passed" },
        ],
      },
    },
  ];

  static ORGANIZATIONS = [
    {
      subjectId: "org:ORG-SUP-A",
      organizationId: "ORG-SUP-A",
      name: "Bengal Relief Foundation",
      type: "ngo",
      status: "active",
      registeredAt: "2026-03-14",
      credentials: [
        { type: "Society registration (simulated)", issuer: "Registrar of Societies (simulated)", id: "SIM-SOC-A-2019", validFrom: "2019-04-12", validUntil: "2029-04-11" },
        { type: "Food safety licence (simulated)", issuer: "Food Safety Authority (simulated)", id: "SIM-FSL-A-2026", validFrom: "2026-02-01", validUntil: "2027-01-31" },
      ],
      reputation: {
        completed: 46, disputes: 1, fulfilmentRate: 0.97, lastActivity: "2026-11-06",
        history: [
          { date: "2026-11-06", event: "Delivered 800 food packets to a relief camp", outcome: "completed" },
          { date: "2026-10-14", event: "Delivered 300 blankets", outcome: "completed" },
          { date: "2026-08-30", event: "Dispute over a short count of water kits", outcome: "resolved" },
          { date: "2026-08-02", event: "Delivered 500 water kits", outcome: "completed" },
        ],
      },
    },
    {
      subjectId: "org:ORG-SUP-B",
      organizationId: "ORG-SUP-B",
      name: "North Bengal Aid Collective",
      type: "ngo",
      status: "active",
      registeredAt: "2026-03-14",
      credentials: [
        { type: "Trust registration (simulated)", issuer: "Registrar of Trusts (simulated)", id: "SIM-TRU-B-2015", validFrom: "2015-08-20", validUntil: "2030-08-19" },
        { type: "Food safety licence (simulated)", issuer: "Food Safety Authority (simulated)", id: "SIM-FSL-B-2026", validFrom: "2026-01-15", validUntil: "2027-01-14" },
        { type: "Drug distribution licence (simulated)", issuer: "Drugs Control Directorate (simulated)", id: "SIM-DDL-B-2025", validFrom: "2025-06-01", validUntil: "2027-05-31" },
      ],
      reputation: {
        completed: 31, disputes: 0, fulfilmentRate: 0.98, lastActivity: "2026-11-08",
        history: [
          { date: "2026-11-08", event: "Delivered 120 medical kits", outcome: "completed" },
          { date: "2026-10-01", event: "Delivered 600 food packets", outcome: "completed" },
          { date: "2026-08-19", event: "Delivered 250 water kits", outcome: "completed" },
        ],
      },
    },
    {
      subjectId: "org:ORG-SUP-C",
      organizationId: "ORG-SUP-C",
      name: "Ganga Basin Supplies Pvt Ltd",
      type: "commercial",
      status: "active",
      registeredAt: "2026-03-20",
      credentials: [
        { type: "Company registration (simulated)", issuer: "Registrar of Companies (simulated)", id: "SIM-COM-C-2012", validFrom: "2012-11-05", validUntil: "2032-11-04" },
        { type: "GST registration (simulated)", issuer: "Goods and Services Tax Network (simulated)", id: "SIM-GST-C-2017", validFrom: "2017-07-01", validUntil: "2031-06-30" },
        { type: "Food safety licence (simulated)", issuer: "Food Safety Authority (simulated)", id: "SIM-FSL-C-2025", validFrom: "2025-10-01", validUntil: "2026-09-30" },
      ],
      reputation: {
        completed: 18, disputes: 2, fulfilmentRate: 0.89, lastActivity: "2026-10-28",
        history: [
          { date: "2026-10-28", event: "Delivered 400 water kits", outcome: "completed" },
          { date: "2026-09-17", event: "Dispute over damaged blankets", outcome: "upheld against the supplier" },
          { date: "2026-07-11", event: "Dispute over a late delivery", outcome: "resolved" },
          { date: "2026-06-05", event: "Delivered 150 medical kits", outcome: "completed" },
        ],
      },
    },
    {
      subjectId: "org:ORG-TR-1",
      organizationId: "ORG-TR-1",
      name: "Malda Fleet Cooperative",
      type: "cooperative",
      status: "active",
      registeredAt: "2026-03-22",
      credentials: [
        { type: "Cooperative registration (simulated)", issuer: "Registrar of Cooperative Societies (simulated)", id: "SIM-COP-TR1-2010", validFrom: "2010-01-18", validUntil: "2030-01-17" },
        { type: "Goods carriage permit (simulated)", issuer: "Regional Transport Authority (simulated)", id: "SIM-GCP-TR1-2026", validFrom: "2026-04-01", validUntil: "2027-03-31" },
      ],
      reputation: {
        completed: 64, disputes: 1, fulfilmentRate: 0.96, lastActivity: "2026-11-13",
        history: [
          { date: "2026-11-13", event: "Carried relief supplies to two block shelters", outcome: "completed" },
          { date: "2026-10-20", event: "Carried 6 tonnes of food packets", outcome: "completed" },
          { date: "2026-08-04", event: "Dispute over a missed pickup window", outcome: "resolved" },
        ],
      },
    },
    {
      subjectId: "org:ORG-TR-2",
      organizationId: "ORG-TR-2",
      name: "Farakka Barge & Boat Union",
      type: "union",
      status: "active",
      registeredAt: "2026-03-22",
      credentials: [
        { type: "Union registration (simulated)", issuer: "Registrar of Trade Unions (simulated)", id: "SIM-UNI-TR2-2014", validFrom: "2014-05-09", validUntil: "2029-05-08" },
        { type: "Inland vessel licence (simulated)", issuer: "Inland Waterways Directorate (simulated)", id: "SIM-IVL-TR2-2026", validFrom: "2026-06-01", validUntil: "2027-05-31" },
      ],
      reputation: {
        completed: 22, disputes: 0, fulfilmentRate: 0.95, lastActivity: "2026-11-02",
        history: [
          { date: "2026-11-02", event: "Boat relay to a flooded embankment village", outcome: "completed" },
          { date: "2026-09-26", event: "Carried medical kits across a breached road", outcome: "completed" },
          { date: "2026-08-15", event: "Boat relay during a simulated drill", outcome: "completed" },
        ],
      },
    },
    {
      subjectId: "org:ORG-TR-3",
      organizationId: "ORG-TR-3",
      name: "Teesta Cargo Movers",
      type: "commercial",
      status: "revoked",
      statusReason: "Goods carriage permit revoked on 2026-10-12 after repeated non-delivery (simulated).",
      registeredAt: "2026-03-25",
      credentials: [
        { type: "Goods carriage permit (simulated)", issuer: "Regional Transport Authority (simulated)", id: "SIM-GCP-TR3-2025", validFrom: "2025-11-01", validUntil: "2026-10-12" },
      ],
      reputation: {
        completed: 12, disputes: 5, fulfilmentRate: 0.58, lastActivity: "2026-10-09",
        history: [
          { date: "2026-10-12", event: "Goods carriage permit revoked", outcome: "registry record revoked" },
          { date: "2026-10-09", event: "Shipment of blankets not delivered", outcome: "upheld against the carrier" },
          { date: "2026-09-18", event: "Shipment of food packets not delivered", outcome: "upheld against the carrier" },
          { date: "2026-08-22", event: "Carried 4 tonnes of water kits", outcome: "completed" },
        ],
      },
    },
    {
      subjectId: "org:ORG-TR-4",
      organizationId: "ORG-TR-4",
      name: "Murshidabad Relief Logistics",
      type: "commercial",
      status: "active",
      registeredAt: "2026-03-27",
      credentials: [
        { type: "Company registration (simulated)", issuer: "Registrar of Companies (simulated)", id: "SIM-COM-TR4-2018", validFrom: "2018-02-14", validUntil: "2033-02-13" },
        { type: "Goods carriage permit (simulated)", issuer: "Regional Transport Authority (simulated)", id: "SIM-GCP-TR4-2026", validFrom: "2026-03-01", validUntil: "2027-02-28" },
      ],
      reputation: {
        completed: 27, disputes: 1, fulfilmentRate: 0.93, lastActivity: "2026-11-05",
        history: [
          { date: "2026-11-05", event: "Carried 3 tonnes of mixed relief supplies", outcome: "completed" },
          { date: "2026-10-11", event: "Dispute over a delayed arrival", outcome: "resolved" },
          { date: "2026-09-02", event: "Carried 5 tonnes of food packets", outcome: "completed" },
        ],
      },
    },
  ];

  /**
   * Reports already on file. ORG-SUP-D (QuickAid Traders) has no registry record at all:
   * a subject can be reported without being registered.
   */
  static REPORTS = [
    {
      subjectId: "org:ORG-SUP-D",
      reason: "price_anomaly",
      details: "Food packets listed at well under half the lowest price of any registered supplier (simulated report).",
      reportedAt: "2026-11-18T09:20:00.000Z",
      reportedBy: "seed",
    },
    {
      subjectId: "org:ORG-SUP-D",
      reason: "unverifiable_address",
      details: "The dispatch address given for QuickAid Traders could not be matched to any premises (simulated report).",
      reportedAt: "2026-11-20T14:05:00.000Z",
      reportedBy: "seed",
    },
    {
      subjectId: "org:ORG-TR-3",
      reason: "non_delivery",
      details: "A shipment of blankets booked with Teesta Cargo Movers never arrived (simulated report).",
      reportedAt: "2026-10-10T07:45:00.000Z",
      reportedBy: "seed",
    },
  ];

  /** Every seeded subject that has a registry record, as [seed, type] pairs. */
  static seededSubjects() {
    return [
      ...RegistryData.AGENT_NETWORKS.map((seed) => [seed, "agent_network"]),
      ...RegistryData.ORGANIZATIONS.map((seed) => [seed, "organization"]),
    ];
  }

  static worseStatus(left, right) {
    return (RegistryData.SEVERITY[left] ?? 0) >= (RegistryData.SEVERITY[right] ?? 0) ? left : right;
  }
}
