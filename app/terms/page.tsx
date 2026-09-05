import type { Metadata } from "next";
import Link from "next/link";

import { LegalPage, type LegalSection } from "@/app/legal-page";
import { CONTACT_URL, OPERATOR_NAME, PROJECT_NAME, SOURCE_URL } from "@/lib/legal";
import { PRESET_MODELS } from "@/lib/preset-models";

export const metadata: Metadata = {
  title: `Terms of Service — ${PROJECT_NAME}`,
  description: `Rules for creators and bidders using the ${PROJECT_NAME} advertising-space auction marketplace.`,
};

const sections: LegalSection[] = [
  {
    id: "agreement",
    title: "Agreement and eligibility",
    content: (
      <>
        <p>These Terms of Service (“Terms”) govern your use of the hosted {PROJECT_NAME} website and auction services operated by <strong>{OPERATOR_NAME}</strong> (“we”, “us”, or “our”). By creating an auction, placing a bid, connecting a Stripe account, or otherwise using the Service, you agree to these Terms and our <Link href="/privacy">Privacy Policy</Link>.</p>
        <p>You must be at least 18 years old, have authority to act for the person or organization you represent, and be legally able to enter a binding contract. Advertising purchases are intended for businesses, professionals, organizations, and people acting for commercial or promotional purposes.</p>
      </>
    ),
  },
  {
    id: "marketplace-roles",
    title: "The marketplace and its participants",
    content: (
      <>
        <p>{PROJECT_NAME} provides software and payment infrastructure for auctions of advertising space. A <strong>creator</strong> lists space on an object, property, media surface, or other placement they control. A <strong>bidder</strong> competes for the right to display approved advertising in that space for the period described in the listing.</p>
        <p>Unless an auction page expressly says otherwise, the creator—not {PROJECT_NAME}—offers and fulfills the advertising placement. We are not a party to the creator’s performance promise, do not endorse either participant, and do not guarantee the creator’s audience, reach, impressions, clicks, conversions, or other results.</p>
      </>
    ),
  },
  {
    id: "creator-duties",
    title: "Creator responsibilities",
    content: (
      <>
        <p>By publishing an auction, a creator confirms that they:</p>
        <ul>
          <li>own or control the advertised surface and have every permission needed to sell the placement;</li>
          <li>will describe the location, dimensions, duration, visibility, production method, starting price, timing, and restrictions accurately;</li>
          <li>will review advertising materials promptly and apply content standards consistently;</li>
          <li>will produce, install, display, maintain, and remove the winning advertisement as promised; and</li>
          <li>will comply with advertising, consumer-protection, tax, intellectual-property, property, transport, and other laws that apply to the placement.</li>
        </ul>
        <p>Creators may reject creative that violates these Terms or the listing’s stated standards. They may not manipulate bidding, bid on their own inventory through another identity, invent traffic or exposure, or offer a placement they cannot fulfill.</p>
      </>
    ),
  },
  {
    id: "bids-and-closing",
    title: "Bids, approval, and auction closing",
    content: (
      <>
        <p>Each auction page states its opening prices, minimum increments, closing time, placement duration, and any additional rules. A bid is an offer to purchase the selected advertising space for the bid amount. Once submitted, a valid bid may not be withdrawn unless the law or the auction page expressly allows it.</p>
        <p>A bid counts only after it passes the Service’s validation and any required payment authorization or creative review. At the stated closing time, the <strong>highest valid bid for each advertising space wins</strong>. The winner enters a binding agreement with the creator to purchase that placement, subject to successful payment and content approval.</p>
        <p>We may reject or invalidate bids affected by fraud, sanctions, payment failure, technical error, collusion, unlawful content, or an obvious pricing mistake. If an outage materially prevents fair bidding, we may extend, rerun, or cancel the affected auction and reverse related payments.</p>
      </>
    ),
  },
  {
    id: "payments",
    title: "Stripe Connect, fees, and payouts",
    content: (
      <>
        <p>Payments and creator payouts are handled through Stripe Connect. By using a connected account or paying through Stripe, you also agree to the applicable <a href="https://stripe.com/legal" target="_blank" rel="noreferrer">Stripe terms</a>. Stripe may require identity, business, bank, tax, or other information before enabling charges or payouts.</p>
        <p>The Service deducts the platform commission disclosed when the auction is created or at checkout—<strong>currently 10% unless a different rate is shown</strong>. Stripe processing, currency-conversion, dispute, refund, and payout fees may also apply. The creator receives the remaining amount after applicable platform commission, Stripe fees, refunds, reserves, chargebacks, and legally required deductions.</p>
        <p>Payment may be authorized or collected when a bid is placed or when the auction closes, as shown in the applicable flow. Losing bids will not be captured, or will be released or refunded, according to the payment method presented for that auction. Bank and card processing times are outside our control.</p>
        <p>Creators are responsible for their own taxes, invoices, reporting, and connected-account obligations. We or Stripe may delay a payout while investigating fraud, a dispute, a refund request, sanctions risk, or a legal requirement.</p>
      </>
    ),
  },
  {
    id: "content",
    title: "Advertising content and licenses",
    content: (
      <>
        <p>You keep ownership of content you upload. You grant us, the relevant creator, and our service providers a non-exclusive, worldwide, royalty-free license to host, reproduce, resize, display, and transmit that content only as needed to operate, promote, document, and fulfill the auction and purchased placement.</p>
        <p>You confirm that you have all rights and permissions needed for submitted names, logos, images, links, models, and advertisements. Content may not be illegal, deceptive, infringing, defamatory, hateful, sexually exploitative, malicious, or designed to promote fraud, unsafe products, or regulated goods in violation of applicable law.</p>
        <p>Paid placement is not an endorsement. A creator may remove content that later becomes unlawful, materially misleading, unsafe, or inconsistent with the listing’s disclosed standards. Any refund should reflect the unfulfilled portion of the promised placement, unless removal resulted from the bidder’s breach.</p>
      </>
    ),
  },
  {
    id: "cancellations-disputes",
    title: "Cancellations, refunds, and disputes",
    content: (
      <>
        <p>If a creator cancels an auction before it closes, payments collected for that auction must be released or refunded. If a creator cannot provide a winning placement, the creator must offer a reasonable replacement or refund the unfulfilled portion. A bidder is not entitled to a refund merely because an advertisement performs differently than hoped.</p>
        <p>Contact the other participant promptly and in good faith if a problem arises. We may request evidence, facilitate communication, issue or require a refund where the platform payment flow permits, restrict an account, or cooperate with Stripe’s dispute process. Card-network and Stripe dispute decisions may be binding on payment handling.</p>
        <p>Chargebacks are not a substitute for first seeking a legitimate resolution. Creators remain responsible for losses resulting from their breach, non-fulfillment, fraud, or chargebacks attributable to their transactions.</p>
      </>
    ),
  },
  {
    id: "service-limits",
    title: "Service availability and liability",
    content: (
      <>
        <p>The Service is provided on an “as is” and “as available” basis to the extent permitted by law. We do not warrant uninterrupted operation, a particular auction outcome, bidder quality, creator performance, advertising results, or that every defect will be corrected.</p>
        <p>To the fullest extent permitted by law, {PROJECT_NAME} and {OPERATOR_NAME} will not be liable for indirect, incidental, special, consequential, exemplary, or lost-profit damages arising from the Service, an auction, a placement, participant conduct, or third-party services. Our total liability for a claim will not exceed the platform commission we received from the transaction giving rise to that claim or USD 100, whichever is greater.</p>
        <p>Nothing in these Terms excludes liability that cannot legally be excluded. You remain responsible for your content, taxes, legal compliance, and obligations to other participants.</p>
      </>
    ),
  },
  {
    id: "third-party-brands",
    title: "3D models, third-party brands, and trademarks",
    content: (
      <>
        <p>Built-in 3D models shown by the Service are either created by us or adapted from models made publicly available under free-to-use licenses. They are representative visualizations—not official manufacturer digital twins or guaranteed exact replicas of any product. Creators may also upload models they made themselves or have permission to use.</p>
        <p>Our bundled third-party 3D models are:</p>
        <ul>
          {Object.values(PRESET_MODELS).map((model) => (
            <li key={model.id}>
              <a href={model.sourceUrl} target="_blank" rel="noreferrer">{model.assetName}</a>
              {" by "}{model.author}{" — "}
              <a href={model.licenseUrl} target="_blank" rel="noreferrer">{model.licenseName}</a>
            </li>
          ))}
        </ul>
        <p><strong>{PROJECT_NAME} is an independent project and is not affiliated with, endorsed by, or sponsored by Apple Inc., Tesla, Inc., Stripe, X Corp., Supabase, Vercel, or any other third-party brand shown on the Service, unless an auction page expressly states otherwise.</strong></p>
        <p>Apple, the Apple logo, Mac, MacBook, MacBook Pro, Magic Keyboard, and Magic Mouse are trademarks of Apple Inc., registered in the United States and other countries and regions. Tesla, the Tesla logo, Model 3, Model S, Model X, Model Y, and Cybertruck are trademarks of Tesla, Inc. Stripe, X, Supabase, and Vercel names and logos are owned by their respective proprietors.</p>
        <p>Third-party names, products, models, and logos are used only to identify compatible objects, payment or infrastructure providers, source assets, or advertising submitted by users. Their appearance does not imply sponsorship, endorsement, partnership, or approval. All other trademarks belong to their respective owners.</p>
        <p>Transformation details, checksums, and attribution for other repository assets are documented in the <a href={`${SOURCE_URL}/blob/main/THIRD_PARTY_ASSETS.md`} target="_blank" rel="noreferrer">third-party assets notice</a>.</p>
      </>
    ),
  },
  {
    id: "open-source",
    title: "Open-source code and independent deployments",
    content: (
      <>
        <p>The <a href={SOURCE_URL} target="_blank" rel="noreferrer">{PROJECT_NAME} source repository</a> is separate from the hosted Service. Use, modification, and distribution of source code are governed by any license and notices published with that repository; these hosted-service Terms do not grant additional rights in the code. Contributions may be governed by the contribution terms or license notices published there.</p>
        <p>Independent deployments are not operated, reviewed, or endorsed by {OPERATOR_NAME}. Their operators set their own fees, rules, privacy practices, and legal terms. These Terms apply only when the deployment or service expressly links to them.</p>
      </>
    ),
  },
  {
    id: "termination-law",
    title: "Suspension, changes, and governing law",
    content: (
      <>
        <p>We may suspend or terminate access, remove content, or cancel affected bids when reasonably necessary to protect the Service, participants, or third parties; comply with law; or address a material breach. Provisions that logically survive termination—including payment, licenses already needed for completed placements, disclaimers, liability limits, and dispute terms—will remain in effect.</p>
        <p>We may update these Terms for future use of the Service. Material changes will be identified by the date at the top and, when reasonably possible, additional notice. Changes will not retroactively alter a completed auction unless required by law or agreed by the affected parties.</p>
        <p>These Terms are governed by the laws applicable where the Service operator is established, without regard to conflict-of-law rules. Courts with jurisdiction over that operator will have exclusive jurisdiction, except where mandatory law gives you another venue. Before filing a claim, please <a href={CONTACT_URL} target="_blank" rel="noreferrer">contact {OPERATOR_NAME}</a> and allow 30 days for an informal resolution.</p>
      </>
    ),
  },
];

export default function TermsOfServicePage() {
  return (
    <LegalPage
      documentLabel="TERMS"
      title="Terms of Service"
      summary="Creators offer real advertising space. Bidders compete for it. The highest valid bid wins at closing, Stripe Connect moves the money, and the platform keeps the commission disclosed in the auction flow."
      sections={sections}
      companionHref="/privacy"
      companionLabel="Read the Privacy Policy"
    />
  );
}
