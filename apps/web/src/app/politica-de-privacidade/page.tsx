import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Mekxa | Politica de Privacidade',
  description: 'Politica de privacidade do aplicactive Mekxa.',
};

const sections = [
  {
    title: '1 Informacoes que coletamos',
    paragraphs: [
      'Podemos coletar alguns dados necessarios para o funcionamento do servico.',
    ],
    items: [
      'Informacoes fornecidas por you: nome, numero de telefone, e-mail, messages, arquivos e imagens enviados nas conversas.',
      'Informacoes coletadas automaticamente: identificadores das plataformas integradas, dados de uso como interacoes e tempo de resposta, endereco IP e informacoes de dispositivo quando aplicavel.',
    ],
  },
  {
    title: '2 Como usamos suas informacoes',
    paragraphs: [
      'Utilizamos os dados para garantir que o aplicactive funcione corretamente e para melhorar a experiencia de uso.',
    ],
    items: [
      'Fornecer e manter o funcionamento do sistema.',
      'Automatizar atendimentos e respostas.',
      'Gerenciar conversas e interacoes com clientes.',
      'Melhorar desempenho e estabilidade da plataforma.',
      'Garantir seguranca e prevenir usos indevidos.',
      'Cumprir obrigacoes legais quando necessario.',
    ],
  },
  {
    title: '3 Compartilhamento de dados',
    paragraphs: [
      'Nao vendemos suas informacoes.',
      'Os dados podem ser compartilhados apenas quando necessario para o funcionamento do servico.',
    ],
    items: [
      'Plataformas integradas como servicos da Meta.',
      'Ferramentas de infraestrutura como servidores e bancos de dados.',
      'Autoridades legais quando houver exigencia.',
    ],
  },
  {
    title: '4 Armazenamento e seguranca',
    paragraphs: [
      'Adotamos medidas para proteger suas informacoes contra acessos nao autorizados, perda ou uso indevido.',
      'Utilizamos controles de acesso, monitoramento e boas praticas de seguranca.',
      'Os dados sao mantidos apenas pelo tempo necessario para cumprir suas finalidades.',
    ],
  },
  {
    title: '5 Retencao de dados',
    paragraphs: [
      'As informacoes sao armazenadas enquanto houver necessidade para o funcionamento do servico ou cumprimento de obrigacoes legais.',
      'Voce pode solicitar a exclusao dos seus dados a qualquer momento.',
    ],
  },
  {
    title: '6 Seus direitos',
    items: [
      'Voce pode solicitar acesso aos seus dados.',
      'Pode corrigir informacoes incorretas.',
      'Pode solicitar a exclusao dos dados.',
      'Pode retirar seu consentimento quando desejar.',
    ],
  },
  {
    title: '7 Uso de APIs da Meta',
    paragraphs: [
      'O aplicactive utiliza APIs oficiais da Meta para envio e recebimento de messages e gerenciamento de interacoes.',
      'O uso dessas informacoes segue as diretrizes e politicas da propria Meta.',
    ],
  },
  {
    title: '8 Alteracoes nesta politica',
    paragraphs: [
      'Esta politica pode ser atualizada ao longo do tempo para refletir melhorias ou mudancas no servico.',
      'Recomendamos a leitura periodica para se manter informado.',
    ],
  },
  {
    title: '9 Consentimento',
    paragraphs: [
      'Ao utilizar o aplicactive you concorda com esta politica de privacidade.',
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
            Voltar para login
          </Link>
        </div>

        <article className="glass-panel rounded-[2rem] border border-white/10 p-6 shadow-[0_30px_100px_rgba(0,0,0,0.24)] backdrop-blur-2xl sm:p-8 lg:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[var(--secondary)]">
            Politica de Privacidade
          </p>
          <h1 className="mt-4 font-headline text-3xl font-semibold text-white sm:text-4xl">
            Politica de Privacidade - Aplicactive Mekxa
          </h1>
          <p className="mt-4 text-sm text-[var(--muted)]">
            Ultima atualizacao 13/04/2026
          </p>
          <p className="mt-6 text-base leading-7 text-white/82">
            A sua privacidade e importante para nos. Esta politica explica de forma clara como o aplicactive Mekxa coleta, usa, armazena e protege suas informacoes durante o uso do sistema, principalmente em integracoes com plataformas da Meta como WhatsApp, Instagram e Facebook.
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
