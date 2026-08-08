/**
 * Business-owner language per business model.
 *
 * A travel advisor has bookings; a shop has sales; an agency has
 * projects. Same ledger underneath — only the word changes, so the
 * screen reads like the owner's own vocabulary.
 */
export interface Noun {
  singular: string;
  plural: string;
  /** Used in "What did they ___?" */
  sold: string;
}

export function nounFor(businessType: string): Noun {
  switch (businessType) {
    case 'travel':
      return { singular: 'Booking', plural: 'Bookings', sold: 'book' };
    case 'ecommerce':
    case 'retail':
      return { singular: 'Sale', plural: 'Sales', sold: 'buy' };
    case 'agency':
    case 'freelancer':
      return { singular: 'Job', plural: 'Jobs', sold: 'hire you for' };
    default:
      return { singular: 'Sale', plural: 'Sales', sold: 'buy' };
  }
}
