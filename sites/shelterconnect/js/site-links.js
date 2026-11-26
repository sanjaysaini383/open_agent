// Addresses of the other ReliefMesh sites, in one place. The page renders its links from
// this object and the read actions return it, so an assistant never invents a link.
// `npm run origins:set -- <profile>` rewrites these when the sites move to other origins.
export class SiteLinks {
  static SELF = "http://localhost:8081";

  static PARTNERS = {
    reliefmesh_command: {
      label: "ReliefMesh Command",
      page: "http://localhost:8080/",
      network: "http://localhost:8080/reliefmesh_command",
      purpose: "Coordinates suppliers and transport for shelters during an incident.",
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
