// AidSupply's pricing policy, as pure functions. The page's quote calculator, the
// request_improved_offer read and the reserve_allocation write all price through this one
// module, so a quote and a reservation can never disagree.
//
// The policy (docs/INTEROP_CONTRACTS.md, section 2):
//
//   tierPct      = quantity >= 1000 ? 8 : quantity >= 500 ? 5 : quantity >= 200 ? 2 : 0
//   reliefPct    = supplier.type == "ngo" ? 2 : 0
//   standardPct  = min(tierPct + reliefPct, offer.maxDiscountPct)
//   standard     = round2(listUnitPrice * (1 - standardPct / 100))
//   floor        = round2(listUnitPrice * (1 - offer.maxDiscountPct / 100))
//
//   no target, or target >= standard   -> quoted = standard
//   floor <= target < standard         -> quoted = round2((standard + target) / 2)
//   target < floor                     -> quoted = standard
//
//   lowestAcceptable(quantity) = round2((standard + floor) / 2)
//
// Everything is deterministic: the same inputs always give the same price.

export class Pricing {
  static TIERS = [
    { minQuantity: 1000, pct: 8 },
    { minQuantity: 500, pct: 5 },
    { minQuantity: 200, pct: 2 },
  ];

  static NGO_RELIEF_PCT = 2;

  /** Round half up to two decimals, without binary floating-point surprises. */
  static round2(value) {
    return Number(`${Math.round(Number(`${value}e2`))}e-2`);
  }

  static round1(value) {
    return Number(`${Math.round(Number(`${value}e1`))}e-1`);
  }

  static tier(quantity) {
    return Pricing.TIERS.find((tier) => quantity >= tier.minQuantity) || null;
  }

  static tierPct(quantity) {
    return Pricing.tier(quantity)?.pct ?? 0;
  }

  static reliefPct(supplierType) {
    return supplierType === "ngo" ? Pricing.NGO_RELIEF_PCT : 0;
  }

  /**
   * The supplier's terms for one quantity of one offer.
   *
   * :param offer: {unitPrice, maxDiscountPct}; unitPrice is the list price.
   * :param supplierType: "ngo" or "commercial".
   * :param quantity: Units asked for.
   * :return: The percentages, the standard and floor prices and the lowest price a
   *   reservation may carry.
   */
  static terms(offer, supplierType, quantity) {
    const tierPct = Pricing.tierPct(quantity);
    const reliefPct = Pricing.reliefPct(supplierType);
    const standardPct = Math.min(tierPct + reliefPct, offer.maxDiscountPct);
    const standard = Pricing.round2(offer.unitPrice * (1 - standardPct / 100));
    const floor = Pricing.round2(offer.unitPrice * (1 - offer.maxDiscountPct / 100));
    return {
      tierPct,
      reliefPct,
      standardPct,
      capped: tierPct + reliefPct > offer.maxDiscountPct,
      standard,
      floor,
      lowestAcceptable: Pricing.round2((standard + floor) / 2),
    };
  }

  /**
   * Price a quote. Says nothing about stock or minimum order: the store checks those.
   *
   * :param offer: {unitPrice, maxDiscountPct}.
   * :param supplierType: "ngo" or "commercial".
   * :param quantity: Units asked for.
   * :param targetUnitPrice: The buyer's hoped-for unit price, or undefined.
   * :return: The list and quoted unit prices, the totals, the saving and the reasons.
   */
  static quote(offer, supplierType, quantity, targetUnitPrice) {
    const terms = Pricing.terms(offer, supplierType, quantity);
    const basis = [];
    const tier = Pricing.tier(quantity);
    basis.push(tier
      ? `Volume tier: ${tier.pct}% off for ${tier.minQuantity.toLocaleString("en-IN")} units or more.`
      : `No volume tier: discounts start at ${Pricing.TIERS.at(-1).minQuantity} units.`);
    if (terms.reliefPct) basis.push(`Relief rate: a further ${terms.reliefPct}% from an NGO supplier.`);
    if (terms.capped) basis.push("The discount is held at this supplier's own limit.");
    if (terms.standardPct === 0 && !terms.capped) basis.push("Standard terms are the list price at this quantity.");

    let quoted = terms.standard;
    const hasTarget = typeof targetUnitPrice === "number" && Number.isFinite(targetUnitPrice);
    if (hasTarget) {
      if (targetUnitPrice >= terms.standard) {
        basis.push("Your target is at or above the standard terms, so the standard terms apply.");
      } else if (targetUnitPrice >= terms.floor) {
        quoted = Pricing.round2((terms.standard + targetUnitPrice) / 2);
        basis.push("Your target is within the supplier's range: met halfway between the standard terms and your target.");
      } else {
        basis.push("Your target is below the supplier's limit; standard terms offered instead.");
      }
    }

    const listTotal = Pricing.round2(offer.unitPrice * quantity);
    const total = Pricing.round2(quoted * quantity);
    return {
      listUnitPrice: offer.unitPrice,
      quotedUnitPrice: quoted,
      discountPct: Pricing.round1((1 - quoted / offer.unitPrice) * 100),
      listTotal,
      total,
      saving: Pricing.round2(listTotal - total),
      basis,
    };
  }

  /** The lowest unit price a reservation of this quantity may carry. */
  static lowestAcceptable(offer, supplierType, quantity) {
    return Pricing.terms(offer, supplierType, quantity).lowestAcceptable;
  }
}
