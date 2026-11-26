// Addresses of the other ReliefMesh sites, in one place. The page renders its links from
// this object and the read actions return it, so an assistant never invents a link.
// `npm run origins:set -- <profile>` rewrites these when the sites move to other origins.
export class SiteLinks {
  static SELF = "http://localhost:8082";

  static PARTNERS = {
    trustregistry: {
      label: "TrustRegistry",
      page: "http://localhost:8083/",
      network: "http://localhost:8083/trustregistry",
      purpose: "Checks whether an organisation or an agent network is verified. AidSupply lists what suppliers declare; it does not verify them.",
    },
    reliefmesh_command: {
      label: "ReliefMesh Command",
      page: "http://localhost:8080/",
      purpose: "Coordinates suppliers and transport for shelters during an incident, and reserves stock here after a person confirms.",
    },
  };

  /** The origins allowed to read this site's shared actions and to make its shared write. */
  static CALLERS = [
    "http://localhost:8080",
  ];

  static asFacts() {
    const links = {};
    for (const [key, value] of Object.entries(SiteLinks.PARTNERS)) {
      links[key] = { label: value.label, page: value.page, purpose: value.purpose };
    }
    return links;
  }
}
