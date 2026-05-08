import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Mekxa | Privacy Policy',
  description: 'Privacy policy for the Mekxa application.',
};

const sections = [
  {
    title: '1 Information we collect',
    paragraphs: [
      'We may collect some data required for the service to work properly.',
    ],
    items: [
      'Information provided by you: name, phone number, email, messages, files, and images sent in conversations.',
      'Information collected automatically: identifiers from integrated platforms, usage data such as interactions and response time, IP address, and device information when applicable.',
    ],
  },
  {
    title: '2 How we use your information',
    paragraphs: [
      'We use data to ensure the application works properly and to improve the user experience.',
    ],
    items: [
      'Provide and maintain system functionality.',
      'Automate support and replies.',
      'Manage conversations and customer interactions.',
      'Improve platform performance and stability.',
      'Ensure security and prevent misuse.',
      'Meet legal obligations when required.',
    ],
  },
  {
    title: '3 Data sharing',
    paragraphs: [
      'We do not sell your information.',
      'Data may be shared only when required for the service to work.',
    ],
    items: [
      'Integrated platforms such as Meta services.',
      'Infrastructure tools such as servers and databases.',
      'Legal authorities when required.',
    ],
  },
  {
    title: '4 Storage and security',
    paragraphs: [
      'We adopt measures to protect your information from unauthorized access, loss, or misuse.',
      'We use access controls, monitoring, and good security practices.',
      'Data is kept only for as long as necessary to fulfill its purposes.',
    ],
  },
  {
    title: '5 Data retention',
    paragraphs: [
      'Information is stored while it is needed for service operation or legal obligations.',
      'You may request deletion of your data at any time.',
    ],
  },
  {
    title: '6 Your rights',
    items: [
      'You may request access to your data.',
      'You may correct incorrect information.',
      'You may request data deletion.',
      'You may withdraw your consent whenever you want.',
    ],
  },
  {
    title: '7 Use of Meta APIs',
    paragraphs: [
      'The application uses official Meta APIs to send and receive messages and manage interactions.',
      'The use of this information follows Meta guidelines and policies.',
    ],
  },
  {
    title: '8 Changes to this policy',
    paragraphs: [
      'This policy may be updated over time to reflect improvements or service changes.',
      'We recommend reading it periodically to stay informed.',
    ],
  },
  {
    title: '9 Consent',
    paragraphs: [
      'By using the application, you agree to this privacy policy.',
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
            Privacy Policy - Mekxa Application
          </h1>
          <p className="mt-4 text-sm text-[var(--muted)]">
            Last updated 04/13/2026
          </p>
          <p className="mt-6 text-base leading-7 text-white/82">
            Your privacy is important to us. This policy clearly explains how the Mekxa application collects, uses, stores, and protects your information while using the system, especially in integrations with Meta platforms such as WhatsApp, Instagram, and Facebook.
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
