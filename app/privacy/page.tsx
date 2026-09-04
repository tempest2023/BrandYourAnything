import type { Metadata } from "next";

import { LegalCallout, LegalPage, type LegalSection } from "@/app/legal-page";
import { CONTACT_URL, OPERATOR_NAME, PROJECT_NAME, SOURCE_URL } from "@/lib/legal";

export const metadata: Metadata = {
  title: `Privacy Policy — ${PROJECT_NAME}`,
  description: `How ${PROJECT_NAME} handles personal data for creators, bidders, and Stripe Connect payments.`,
};

const sections: LegalSection[] = [
  {
    id: "scope",
    title: "Who we are and where this policy applies",
    content: (
      <>
        <p>{PROJECT_NAME} is an open-source advertising-auction project maintained and operated by <strong>{OPERATOR_NAME}</strong> (“we”, “us”, or “our”). This policy applies to the hosted {PROJECT_NAME} website, auction pages, and related services that link to it (the “Service”).</p>
        <p>The <a href={SOURCE_URL} target="_blank" rel="noreferrer">source code is publicly available on GitHub</a>. A person or organization running its own copy is a separate operator and is responsible for its own privacy notice and data practices. This policy does not automatically apply to independent deployments.</p>
      </>
    ),
  },
  {
    id: "data-we-collect",
    title: "Information we collect",
    content: (
      <>
        <h3>When you create an auction</h3>
        <p>We collect the public name and account information used to identify the creator, a private contact email, auction titles and descriptions, pricing and timing, and any photos, logos, 3D models, or other files you provide. If you sign in through X, we receive the account information needed to authenticate you.</p>
        <h3>When you bid or advertise</h3>
        <p>We collect your brand or bidder name, email address, website, optional social handle, logo or creative assets, bid amount, bid time, selected advertising space, and records of whether the bid was accepted, outbid, won, cancelled, or refunded.</p>
        <h3>Payments and Stripe Connect</h3>
        <p>Stripe processes payments, connected-account onboarding, identity checks, and payouts. We receive limited transaction details such as Stripe identifiers, payment and payout status, amount, currency, platform fee, refund, dispute, and chargeback information. <strong>We do not receive or store full card numbers, bank-account credentials, or the identity documents you submit directly to Stripe.</strong></p>
        <h3>Device and usage information</h3>
        <p>Our hosting and security providers may process IP addresses, browser and device details, requested pages, timestamps, and diagnostic logs. We use essential cookies or browser storage for language, currency, sign-in state, draft auctions, and security. We do not use this information to sell profiles or run cross-site behavioral advertising.</p>
      </>
    ),
  },
  {
    id: "public-information",
    title: "What becomes public",
    content: (
      <>
        <p>Auctions are designed to be public. A creator’s display name, auction description, object images or models, available advertising spaces, prices, bids, and closing time may be visible to everyone. For accepted bids, the bidder or brand name, logo, website, bid amount, and bid time may also be public.</p>
        <LegalCallout>
          <p><strong>Private by default:</strong> contact email addresses, Stripe account identifiers, payment details, authentication tokens, and unpublished or rejected creative files are not intentionally displayed on public auction pages.</p>
        </LegalCallout>
        <p>Do not upload confidential information as a public name, auction description, logo, image, model, website, or other field intended for publication.</p>
      </>
    ),
  },
  {
    id: "how-we-use-data",
    title: "How and why we use information",
    content: (
      <>
        <p>We use information to:</p>
        <ul>
          <li>create, publish, secure, and administer auctions;</li>
          <li>record bids, determine the highest valid bid at closing, and notify participants;</li>
          <li>process payments, deduct the disclosed platform commission, facilitate creator payouts, and handle refunds or disputes through Stripe Connect;</li>
          <li>review advertising materials, prevent fraud or abuse, and enforce our terms;</li>
          <li>respond to support, privacy, and legal requests; and</li>
          <li>maintain, debug, and improve the Service.</li>
        </ul>
        <p>Depending on where you live, our legal bases are performance of a contract, our legitimate interests in operating and protecting the marketplace, compliance with legal obligations, and consent where the law requires it.</p>
      </>
    ),
  },
  {
    id: "sharing",
    title: "Who receives information",
    content: (
      <>
        <p>We share information only as needed to run the Service:</p>
        <ul>
          <li><strong>Creators and winning bidders.</strong> We share the details reasonably needed to approve, produce, deliver, and support the purchased advertising placement.</li>
          <li><strong>Stripe.</strong> Stripe processes connected accounts, payments, payouts, refunds, and disputes under its own <a href="https://stripe.com/privacy" target="_blank" rel="noreferrer">privacy policy</a>.</li>
          <li><strong>Infrastructure providers.</strong> Supabase stores application data and uploaded assets; our deployment and hosting providers serve the application and maintain operational logs.</li>
          <li><strong>Authorities and advisers.</strong> We may disclose information when required by law, to protect rights and safety, or in connection with a reorganization of the Service.</li>
        </ul>
        <p>We do not sell personal information. Service providers may process data in countries other than yours, subject to the safeguards required by applicable law.</p>
      </>
    ),
  },
  {
    id: "retention-security",
    title: "Retention and security",
    content: (
      <>
        <p>We keep auction and bid records for as long as they are needed to operate the placement, resolve disputes, prevent fraud, and maintain an accurate transaction history. Payment, tax, and accounting records may be kept for the period required by law. Rejected uploads, abandoned drafts, and inactive account data may be deleted or anonymized earlier.</p>
        <p>We use reasonable technical and organizational safeguards, including access controls and restricted storage for non-public information. No internet service is completely secure, so we cannot guarantee absolute security.</p>
      </>
    ),
  },
  {
    id: "choices-rights",
    title: "Your choices and privacy rights",
    content: (
      <>
        <p>Depending on your location, you may have the right to access, correct, delete, restrict, or obtain a copy of your personal information, object to certain processing, or withdraw consent. You may also complain to your local data-protection authority.</p>
        <p>Some information cannot be deleted immediately when it must be retained for payments, fraud prevention, legal claims, tax, or accounting obligations. Public bid history may be anonymized instead of removed when preserving auction integrity is necessary.</p>
        <p>To make a request, <a href={CONTACT_URL} target="_blank" rel="noreferrer">contact {OPERATOR_NAME}</a>. We may need to verify that the request relates to you before acting on it.</p>
      </>
    ),
  },
  {
    id: "children-changes",
    title: "Children and policy changes",
    content: (
      <>
        <p>The Service is not directed to children, and auction participation is limited to people who can enter a binding contract. We do not knowingly collect personal information from children.</p>
        <p>We may update this policy as the Service, payment flow, or law changes. The date at the top shows the current version. If a change materially affects active creators or bidders, we will provide additional notice when reasonably possible.</p>
      </>
    ),
  },
];

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      documentLabel="PRIVACY"
      title="Privacy Policy"
      summary="Auctions are public; payment and contact details are not. We collect the information needed to publish advertising spaces, run fair bids, and move money safely through Stripe Connect."
      sections={sections}
      companionHref="/terms"
      companionLabel="Read the Terms of Service"
    />
  );
}
