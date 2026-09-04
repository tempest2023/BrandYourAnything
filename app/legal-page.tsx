import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  CONTACT_URL,
  LEGAL_LAST_UPDATED,
  OPERATOR_NAME,
  PROJECT_NAME,
  SOURCE_URL,
} from "@/lib/legal";

import styles from "./legal-page.module.css";

export type LegalSection = {
  id: string;
  title: string;
  content: ReactNode;
};

export function LegalCallout({ children }: { children: ReactNode }) {
  return <div className={styles.callout}>{children}</div>;
}

type LegalPageProps = {
  documentLabel: string;
  title: string;
  summary: string;
  sections: LegalSection[];
  companionHref: "/privacy" | "/terms";
  companionLabel: string;
};

export function LegalPage({
  documentLabel,
  title,
  summary,
  sections,
  companionHref,
  companionLabel,
}: LegalPageProps) {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#legal-content">Skip to legal content</a>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/" aria-label={`${PROJECT_NAME} home`}>
            <Image src="/logo-small.png" alt="" width={44} height={44} priority />
            <span>{PROJECT_NAME}</span>
          </Link>
          <nav className={styles.headerNav} aria-label="Legal navigation">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <a href={SOURCE_URL} target="_blank" rel="noreferrer">Source ↗</a>
          </nav>
        </div>
      </header>

      <main id="legal-content" className={styles.main}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>{documentLabel} / OPEN-SOURCE MARKETPLACE</p>
          <h1>{title}</h1>
          <p className={styles.summary}>{summary}</p>
          <dl className={styles.documentMeta}>
            <div><dt>Last updated</dt><dd>{LEGAL_LAST_UPDATED}</dd></div>
            <div><dt>Operator</dt><dd>{OPERATOR_NAME}</dd></div>
            <div><dt>Applies to</dt><dd>The hosted Brand Anything service</dd></div>
          </dl>
        </header>

        <div className={styles.legalGrid}>
          <aside className={styles.index} aria-label={`${title} sections`}>
            <p>On this page</p>
            <ol>
              {sections.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </aside>

          <article className={styles.article}>
            {sections.map((section, index) => (
              <section id={section.id} key={section.id}>
                <div className={styles.sectionNumber} aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <div>
                  <h2>{section.title}</h2>
                  {section.content}
                </div>
              </section>
            ))}
          </article>
        </div>
      </main>

      <footer className={styles.footer}>
        <div>
          <p><strong>{PROJECT_NAME}</strong> is maintained by {OPERATOR_NAME} and published with source available on GitHub.</p>
          <nav aria-label="Footer navigation">
            <Link href={companionHref}>{companionLabel}</Link>
            <a href={CONTACT_URL} target="_blank" rel="noreferrer">Contact Tempest ↗</a>
            <Link href="/">Back to auctions</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
