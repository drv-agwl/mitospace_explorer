import React from 'react';

type IconProps = { size?: number; className?: string };

function publicIcon(path: string): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  return `${base}${path}`;
}

/** Official GitHub Mark. */
export const GitHubIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 98 96"
    fill="currentColor"
    aria-hidden="true"
    className={className}
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.777-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
    />
  </svg>
);

/** Official Hugging Face hugging-face mark (raster supplied by the lab). */
export const HuggingFaceIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <img
    src={publicIcon('/icons/huggingface.png')}
    alt=""
    width={size}
    height={size}
    draggable={false}
    aria-hidden="true"
    className={`object-contain select-none ${className ?? ''}`}
  />
);

/**
 * Scholarly article — folded page with a title bar and body lines punched
 * out of the fill. That is the academic-UI convention (Semantic Scholar,
 * Papers with Code) and stays at GitHub-mark weight at 22px, unlike a
 * stroke file icon or a fake journal wordmark.
 */
export const PaperIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    className={className}
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M7 2.6A2.15 2.15 0 0 0 4.85 4.75v14.5A2.15 2.15 0 0 0 7 21.4h10a2.15 2.15 0 0 0 2.15-2.15V8.55L13.45 2.6H7zm6.45.35v4.2c0 .7.57 1.27 1.27 1.27h4.43L13.45 2.95zM8.15 11.2h7.7c.44 0 .8.36.8.8v.55c0 .44-.36.8-.8.8h-7.7a.8.8 0 0 1-.8-.8v-.55c0-.44.36-.8.8-.8zm0 3.05h7.7a.65.65 0 1 1 0 1.3h-7.7a.65.65 0 1 1 0-1.3zm0 2.5h5.15a.65.65 0 1 1 0 1.3H8.15a.65.65 0 1 1 0-1.3z"
    />
  </svg>
);

export const RESEARCH_LINKS = {
  paper: {
    href: 'https://www.cell.com/cell/fulltext/S0092-8674(26)01001-9',
    label: 'Paper',
    hint: 'Cell',
    description: 'The full study, with methods and results.',
  },
  github: {
    href: 'https://github.com/schoeneberglab/MitoSpace4D',
    label: 'Code',
    hint: 'GitHub',
    description: 'Training pipeline and analysis code.',
  },
  huggingface: {
    href: 'https://huggingface.co/schoeneberglab/mitospace',
    label: 'Model',
    hint: 'Hugging Face',
    description: 'Weights, model card and usage notes.',
  },
} as const;

const ICONS = {
  paper: PaperIcon,
  github: GitHubIcon,
  huggingface: HuggingFaceIcon,
} as const;

const LINK_ORDER = ['paper', 'github', 'huggingface'] as const;

/** Optical sizes: color rasters read larger than monochrome glyphs. */
const HEADER_ICON_SIZE = {
  paper: 22,
  github: 22,
  huggingface: 24,
} as const;

const FOOTER_ICON_SIZE = {
  paper: 15,
  github: 15,
  huggingface: 17,
} as const;

const extLinkProps = {
  target: '_blank',
  rel: 'noopener noreferrer',
} as const;

/** Header cluster — sized to the About/Lab text, not a 16px afterthought. Hidden on phones (links are in the footer). */
export const HeaderResearchNav: React.FC = () => (
  <div className="hidden sm:flex items-center gap-1 pl-3 ml-1 border-l border-white/[0.12]">
    {LINK_ORDER.map((key) => {
      const link = RESEARCH_LINKS[key];
      const Icon = ICONS[key];
      return (
        <a
          key={key}
          href={link.href}
          {...extLinkProps}
          title={`${link.label} · ${link.hint}`}
          aria-label={`${link.label} (${link.hint})`}
          className="inline-flex items-center justify-center w-11 h-11 rounded-xl text-white/80 hover:text-white hover:bg-white/[0.1] transition-colors"
        >
          <Icon size={HEADER_ICON_SIZE[key]} />
        </a>
      );
    })}
  </div>
);

/** Text + icon row for the footer chrome. */
export const FooterResearchLinks: React.FC = () => (
  <>
    {LINK_ORDER.map((key) => {
      const link = RESEARCH_LINKS[key];
      const Icon = ICONS[key];
      return (
        <a
          key={key}
          href={link.href}
          {...extLinkProps}
          className="inline-flex items-center gap-1.5 hover:text-white/80 transition-colors"
        >
          <Icon size={FOOTER_ICON_SIZE[key]} />
          {link.label}
        </a>
      );
    })}
  </>
);
