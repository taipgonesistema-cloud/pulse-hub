import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Mekxa | Privacy Policy',
  description: 'General privacy policy for the Mekxa application and related services.',
};

const sections = [
  {
    title: '1 Scope of this policy',
    paragraphs: [
      'This Privacy Policy explains how we collect, use, store, share, and protect personal information when you access or use our application, website, dashboard, integrations, support channels, or related services.',
      'This policy applies to general use of the service, whether you are visiting a public page, creating an account, contacting support, using integrations, or interacting with features made available in the platform.',
      'If a specific product, contract, or legal notice provides additional privacy terms, those additional terms may also apply to that specific use.',
    ],
  },
  {
    title: '2 Information we may collect',
    paragraphs: [
      'The information we collect depends on how you use the service and which features are enabled.',
    ],
    items: [
      'Account and profile information, such as name, email address, phone number, role, login credentials, and preferences.',
      'Content and communication data, such as messages, files, images, media, comments, forms, support requests, and information you choose to submit.',
      'Usage and device data, such as IP address, browser type, operating system, device identifiers, access dates, pages viewed, interactions, logs, and approximate location inferred from technical data.',
      'Integration data received from connected third-party services when you authorize or configure those integrations.',
      'Payment, billing, or commercial information when paid features, subscriptions, invoices, or transactions are available.',
    ],
  },
  {
    title: '3 How we use information',
    paragraphs: [
      'We use personal information for legitimate operational, security, support, communication, and service improvement purposes.',
    ],
    items: [
      'Provide, operate, maintain, personalize, and improve the service.',
      'Create and manage accounts, authentication, permissions, settings, and user sessions.',
      'Process requests, provide support, respond to questions, and send service-related communications.',
      'Enable integrations, automation, notifications, analytics, reporting, and other features requested by users.',
      'Monitor service performance, troubleshoot issues, prevent fraud, protect accounts, and enforce our terms and policies.',
      'Comply with legal obligations, regulatory requirements, court orders, or lawful requests from authorities.',
    ],
  },
  {
    title: '4 Cookies and similar technologies',
    paragraphs: [
      'We may use cookies, local storage, pixels, tags, or similar technologies to keep you signed in, remember preferences, improve performance, understand usage, and protect the service.',
      'You can usually control cookies through your browser settings. Some features may not work correctly if cookies or local storage are disabled.',
    ],
  },
  {
    title: '5 How we share information',
    paragraphs: [
      'We do not sell personal information. We may share information only when necessary for the purposes described in this policy.',
    ],
    items: [
      'Service providers that help us host, secure, maintain, analyze, communicate, process payments, or operate the service.',
      'Third-party integrations that you choose to connect or authorize.',
      'Business partners or account administrators when the service is provided through an organization or shared workspace.',
      'Professional advisers, auditors, insurers, or legal representatives when reasonably necessary.',
      'Authorities, regulators, courts, or other parties when required by law or to protect rights, safety, and security.',
      'Successors in connection with a merger, acquisition, financing, restructuring, or sale of assets, subject to appropriate protections.',
    ],
  },
  {
    title: '6 Data retention',
    paragraphs: [
      'We keep personal information only for as long as reasonably necessary to provide the service, comply with legal obligations, resolve disputes, enforce agreements, maintain security, and support legitimate business needs.',
      'Retention periods may vary depending on the type of data, account settings, legal requirements, backup cycles, and the context in which the information was collected.',
    ],
  },
  {
    title: '7 Security',
    paragraphs: [
      'We use reasonable administrative, technical, and organizational measures designed to protect personal information against unauthorized access, loss, misuse, alteration, or disclosure.',
      'No method of transmission or storage is completely secure. You are responsible for keeping your credentials confidential and for using secure devices and networks when accessing the service.',
    ],
  },
  {
    title: '8 International transfers',
    paragraphs: [
      'Depending on where you are located and how the service is hosted or integrated, personal information may be processed in countries different from your country of residence.',
      'When information is transferred internationally, we use appropriate safeguards when required by applicable law.',
    ],
  },
  {
    title: '9 Your privacy rights',
    paragraphs: [
      'Depending on your location, you may have rights regarding your personal information. These rights may be subject to legal limitations and identity verification.',
    ],
    items: [
      'Access, confirm, or receive a copy of personal information we process about you.',
      'Correct incomplete, inaccurate, or outdated information.',
      'Request deletion, anonymization, restriction, or portability of personal information when applicable.',
      'Object to certain processing activities or withdraw consent when processing is based on consent.',
      'Manage communication preferences and browser-based tracking settings.',
    ],
  },
  {
    title: '10 Third-party services and links',
    paragraphs: [
      'The service may include links, integrations, embeds, APIs, or features provided by third parties. Their privacy practices are governed by their own policies, not by this Privacy Policy.',
      'You should review the privacy policies and settings of any third-party service before connecting it or sharing information with it.',
    ],
  },
  {
    title: '11 Children and minors',
    paragraphs: [
      'The service is not intended for children under the minimum age required by applicable law. We do not knowingly collect personal information from children without appropriate consent.',
      'If you believe a child has provided personal information through the service, contact us so we can review and take appropriate action.',
    ],
  },
  {
    title: '12 Changes to this policy',
    paragraphs: [
      'We may update this Privacy Policy from time to time to reflect changes in the service, legal requirements, security practices, or business operations.',
      'When changes are material, we may provide additional notice through the service or other appropriate channels. The updated version will indicate the latest revision date.',
    ],
  },
  {
    title: '13 Contact',
    paragraphs: [
      'If you have questions, requests, or concerns about this Privacy Policy or how personal information is handled, contact the service administrator or the support channel made available in the application.',
    ],
  },
];

export default function PrivacyPolicyPage() {
  return (
    <main
      className="relative min-h-[100dvh] overflow-y-auto px-4 py-6 text-[var(--foreground)] sm:px-6 sm:py-8 lg:px-10 lg:py-10"
      style={{ background: 'var(--login-background)' }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-70 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:120px_120px] [mask-image:radial-gradient(circle_at_center,black,transparent_90%)]" />

      <div className="relative mx-auto w-full max-w-5xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/72 transition hover:border-white/20 hover:bg-white/8 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to login
          </Link>
        </div>

        <article className="glass-panel rounded-[2rem] border border-white/10 p-6 shadow-[0_30px_100px_rgba(0,0,0,0.24)] backdrop-blur-2xl sm:p-8 lg:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[var(--secondary)]">
            Privacy Policy
          </p>
          <h1 className="mt-4 font-headline text-3xl font-semibold text-white sm:text-4xl">
            Privacy Policy for General Use
          </h1>
          <p className="mt-4 text-sm text-[var(--muted)]">
            Last updated May 9, 2026
          </p>
          <p className="mt-6 text-base leading-7 text-white/82">
            Your privacy matters. This policy provides a general overview of how personal information may be handled when you use our services, including digital products, websites, dashboards, integrations, support channels, and related features.
          </p>

          <div className="mt-10 space-y-8">
            {sections.map((section) => (
              <section key={section.title} className="space-y-4">
                <h2 className="font-headline text-2xl font-semibold text-white">{section.title}</h2>
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph} className="text-sm leading-7 text-white/78 sm:text-base">
                    {paragraph}
                  </p>
                ))}
                {section.items?.length ? (
                  <ul className="space-y-2 text-sm leading-7 text-white/78 sm:text-base">
                    {section.items.map((item) => (
                      <li key={item} className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3">
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
        </article>
      </div>
    </main>
  );
}
