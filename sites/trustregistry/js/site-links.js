// Addresses of the other ReliefMesh sites, in one place. The page renders its links from
// this object and the read actions return it, so an assistant never invents a link.
// `npm run origins:set -- <profile>` rewrites these when the sites move to other origins.
export class SiteLinks {
  static SELF = "http://localhost:8083";

  /**
   * TrustRegistry calls no other agent network: a registry is called, it does not call.
   * These are plain page links for visitors.
   */
  static PAGES = {
    reliefmesh_command: {
      label: "ReliefMesh Command",
      page: "http://localhost:8080/",
      purpose: "Coordinates suppliers and transport for shelters during an incident.",
    },
    shelterconnect: {
      label: "ShelterConnect",
      page: "http://localhost:8081/",
      purpose: "Registers emergency shelters and publishes their resource requests.",
    },
    aidsupply: {
      label: "AidSupply Network",
      page: "http://localhost:8082/",
      purpose: "Lists suppliers and their relief-supply offers.",
    },
    routebridge: {
      label: "RouteBridge",
      page: "http://localhost:8084/",
      purpose: "Lists transport providers and plans relief shipments.",
    },
  };

  /** The origins allowed to read this site's shared actions and to make its shared write. */
  static CALLERS = [
    "http://localhost:8080",
    "http://localhost:8082",
  ];

  static asFacts() {
    const links = {};
    for (const [key, value] of Object.entries(SiteLinks.PAGES)) {
      links[key] = { label: value.label, page: value.page, purpose: value.purpose };
    }
    return links;
  }
}
