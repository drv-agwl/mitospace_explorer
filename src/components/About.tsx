import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Check, Clapperboard, Columns3, Copy, Rotate3d, Sparkles } from 'lucide-react';
import Header from './Header';
import Footer from './Footer';
import ExplorerPreview from './ExplorerPreview';
import { RESEARCH_LINKS, PaperIcon, GitHubIcon, HuggingFaceIcon } from './ResearchLinks';
import { trackEvent } from '../analytics';

// From the publisher's RIS export (Cell 189, 5962–5979.e6).
const PAPER_DOI_URL = 'https://doi.org/10.1016/j.cell.2026.08.028';

const PAPER_CITATION_TEXT =
  'Agarwal, D., Wang, Z., Arkfeld, E., Modolo, A., Natekar, P., Hakozaki, H., Arora, M., McMahon, G., ' +
  'Nahar, S., Doshi, M., and Schöneberg, J. (2026). 4D spatiotemporal landscape of mitochondrial ' +
  'phenotypes across cellular states unlocked through representation learning. Cell 189, ' +
  '5962–5979.e6.';
const PAPER_CITATION = `${PAPER_CITATION_TEXT} ${PAPER_DOI_URL}`;

const PAPER_BIBTEX = `@article{agarwal2026mitospace,
  author    = {Agarwal, Dhruv and Wang, Zichen and Arkfeld, Eric and Modolo, Andre and Natekar, Parth and Hakozaki, Hiroyuki and Arora, Mehul and McMahon, Gillian and Nahar, Siddharth and Doshi, Manav and Sch{\\"o}neberg, Johannes},
  title     = {4D spatiotemporal landscape of mitochondrial phenotypes across cellular states unlocked through representation learning},
  journal   = {Cell},
  volume    = {189},
  number    = {19},
  pages     = {5962--5979.e6},
  year      = {2026},
  publisher = {Elsevier},
  doi       = {10.1016/j.cell.2026.08.028},
  url       = {${PAPER_DOI_URL}},
}`;

const CODE_REPO = RESEARCH_LINKS.github.href;
const LAB_URL = 'https://www.schoeneberglab.org/';

const STATS = [
  { value: '~40,000', label: 'single-cell 4D mitochondrial movies in the training set' },
  { value: '25+', label: 'drug perturbations, plus a DMSO vehicle control' },
  { value: '4D', label: 'lattice light-sheet imaging, 3D over time' },
  { value: '2,048', label: 'dimensions in each cell\u2019s learned embedding' },
];

const STEPS = [
  {
    title: '4D imaging',
    body: 'Cells are imaged in 3D over time with high-resolution lattice light-sheet microscopy, each under a defined perturbation: one of 25+ drugs or a DMSO vehicle control.',
  },
  {
    title: 'Self-supervised learning',
    body: 'A contrastive learning framework learns compact representations of mitochondrial morphology and dynamics directly from raw imaging data, without manual annotation. Each cell is encoded as a 2,048-dimensional embedding.',
  },
  {
    title: 'Projection',
    body: 'UMAP projects the embeddings into the 3D map shown in the explorer, so nearby points are cells with similar learned representations. Image-derived mitochondrial features, such as fission rate and fragment length, can be overlaid on the map as semantic axes.',
  },
];

const FEATURES = [
  {
    Icon: Rotate3d,
    title: 'Interactive atlas',
    body: 'Navigate the 3D embedding to explore phenotypic relationships across perturbations and inspect individual cells in detail.',
  },
  {
    Icon: Clapperboard,
    title: 'Condition overview',
    body: 'Representative single-cell movies provide a rapid overview of mitochondrial phenotypes across drug conditions and cellular states.',
  },
  {
    Icon: Sparkles,
    title: 'Semantic axes',
    body: 'Visualize continuous gradients of mitochondrial features directly within the embedding space, and relate learned representations to interpretable biological properties.',
  },
  {
    Icon: Columns3,
    title: 'Cell comparison',
    body: 'Place up to six cells from the same or different conditions side by side, with frame-locked movies and every image-derived feature ranked as a percentile among all measured cells.',
  },
];

const RESOURCES = [
  { ...RESEARCH_LINKS.paper, Icon: PaperIcon },
  { ...RESEARCH_LINKS.github, Icon: GitHubIcon },
  { ...RESEARCH_LINKS.huggingface, Icon: HuggingFaceIcon },
] as const;

/** Paper author order; true marks equal contribution. */
const AUTHORS: Array<[name: string, equal: boolean]> = [
  ['Dhruv Agarwal', true],
  ['Zichen Wang', true],
  ['Eric Arkfeld', true],
  ['Andre Modolo', true],
  ['Parth Natekar', true],
  ['Hiroyuki Hakozaki', true],
  ['Mehul Arora', false],
  ['Gillian McMahon', false],
  ['Siddharth Nahar', false],
  ['Manav Doshi', false],
  ['Johannes Schöneberg', false],
];

const SECTION = 'py-14 sm:py-16 border-t border-white/[0.08]';
const H2 = 'text-2xl sm:text-[28px] font-semibold tracking-tight text-white';
const LEAD = 'mt-3 max-w-2xl text-base text-white/65 leading-relaxed';
const ICON_TILE =
  'inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.05] text-white/90';
const PRIMARY =
  'inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl text-sm font-semibold bg-white text-black hover:bg-gray-100 transition-colors';
const SECONDARY =
  'inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl text-sm font-medium border border-white/[0.14] bg-white/[0.05] text-white hover:bg-white/[0.1] transition-colors';
const TEXT_LINK = 'text-white/85 underline decoration-white/30 underline-offset-2 hover:text-white';
const external = { target: '_blank', rel: 'noopener noreferrer' } as const;

const CopyTextButton: React.FC<{ text: string; label: string }> = ({ text, label }) => {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      trackEvent('copy_text', { what: label });
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is best-effort (permissions / insecure context).
    }
  }, [text, label]);
  return (
    <button
      type="button"
      onClick={onCopy}
      className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg text-sm font-medium border border-white/[0.12] bg-white/[0.04] text-white/90 hover:bg-white/[0.08] transition-colors"
    >
      {copied ? <Check size={15} strokeWidth={2.5} /> : <Copy size={15} />}
      {copied ? 'Copied' : label}
    </button>
  );
};

const About: React.FC = () => {
  // How far visitors read: each section heading reaching the upper 60% of the screen, once.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          trackEvent('about_section', { section: entry.target.id.replace(/^about-/, '') });
        }
      },
      { rootMargin: '0px 0px -40% 0px' }
    );
    document.querySelectorAll('h2[id^="about-"]').forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <Header />
      <main className="flex-grow">
        <div className="mx-auto w-full max-w-5xl px-6 sm:px-8">
          {/* Hero */}
          <section className="pt-14 pb-14 sm:pt-20 sm:pb-16">
            <a
              href={RESEARCH_LINKS.paper.href}
              {...external}
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.04] px-3 py-1 text-xs text-white/75 hover:text-white hover:border-white/25 transition-colors"
            >
              <PaperIcon size={13} />
              <span>
                Published in <span className="font-semibold text-white">Cell</span> · 2026
              </span>
              <ArrowUpRight size={12} className="text-white/50" />
            </a>
            <h1 className="mt-6 max-w-3xl text-4xl sm:text-5xl lg:text-[56px] font-semibold tracking-tight leading-[1.06]">
              About MitoSpace Explorer
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-white/65 leading-relaxed">
              A browser-based atlas of mitochondrial phenotypes under drug perturbation, built from
              high-resolution 4D lattice light-sheet microscopy data. MitoSpace organizes single-cell
              mitochondrial behaviors into an interactive latent space for exploration, comparison, and
              biological interpretation.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/" className={PRIMARY} onClick={() => trackEvent('cta_click', { where: 'about_hero' })}>
                Open the explorer
                <ArrowRight size={16} />
              </Link>
              <a href={RESEARCH_LINKS.paper.href} {...external} className={SECONDARY}>
                <PaperIcon size={16} />
                Read the paper
              </a>
            </div>
            <p className="mt-3 text-xs text-white/50 lg:hidden">
              The explorer itself needs a screen at least 1,024 px wide.
            </p>
            <ExplorerPreview priority className="mt-12 sm:mt-14" />

            <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-px overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.08]">
              {STATS.map(({ value, label }) => (
                <div key={label} className="bg-black p-5 sm:p-6">
                  <p className="text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
                  <p className="mt-1.5 text-sm text-white/60 leading-snug">{label}</p>
                </div>
              ))}
            </div>
          </section>

          {/* What is MitoSpace? */}
          <section className={SECTION} aria-labelledby="about-what">
            <h2 id="about-what" className={H2}>
              What is MitoSpace?
            </h2>
            <div className="mt-5 max-w-3xl space-y-4 text-base text-white/65 leading-relaxed">
              <p>
                <span className="font-medium text-white">MitoSpace</span> is a self-supervised representation
                space learned from high-resolution 4D mitochondrial imaging data. Each point in the atlas
                corresponds to a single-cell mitochondrial movie captured using lattice light-sheet microscopy
                under a defined perturbation condition.
              </p>
              <p>
                The embedding space organizes cells according to shared spatiotemporal mitochondrial
                phenotypes, enabling comparison of drug responses, visualization of phenotypic gradients, and
                exploration of biological relationships across perturbations. The explorer connects these
                learned representations with classical mitochondrial features, allowing users to move between
                raw imaging data, interpretable measurements, and latent representations within a unified
                interface.
              </p>
            </div>
          </section>

          {/* How it's built */}
          <section className={SECTION} aria-labelledby="about-how">
            <h2 id="about-how" className={H2}>
              How it’s built
            </h2>
            <p className={LEAD}>From 4D lattice light-sheet movies to an interactive latent space.</p>
            <ol className="mt-10 grid gap-10 sm:gap-8 sm:grid-cols-3">
              {STEPS.map(({ title, body }, i) => (
                <li key={title} className="border-t border-white/[0.16] pt-5">
                  <p className="font-mono text-xs text-white/45">{String(i + 1).padStart(2, '0')}</p>
                  <h3 className="mt-2 text-lg font-semibold">{title}</h3>
                  <p className="mt-2 text-sm text-white/65 leading-relaxed">{body}</p>
                </li>
              ))}
            </ol>
          </section>

          {/* What the explorer does */}
          <section className={SECTION} aria-labelledby="about-features">
            <h2 id="about-features" className={H2}>
              In the explorer
            </h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {FEATURES.map(({ Icon, title, body }) => (
                <div key={title} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-6">
                  <span className={ICON_TILE}>
                    <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{title}</h3>
                  <p className="mt-2 text-sm text-white/65 leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Paper, code, model */}
          <section className={SECTION} aria-labelledby="about-resources">
            <h2 id="about-resources" className={H2}>
              Paper, code and model
            </h2>
            <p className={LEAD}>
              The peer-reviewed publication, the training and analysis code, and the pretrained model weights.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {RESOURCES.map(({ href, label, hint, description, Icon }) => (
                <a
                  key={href}
                  href={href}
                  {...external}
                  className="group rounded-xl border border-white/[0.08] bg-white/[0.03] p-6 hover:border-white/[0.18] hover:bg-white/[0.05] transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <span className={ICON_TILE}>
                      <Icon size={label === 'Model' ? 22 : 18} />
                    </span>
                    <ArrowUpRight size={16} className="text-white/35 group-hover:text-white/70 transition-colors" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold">
                    {label} <span className="font-normal text-white/50">· {hint}</span>
                  </h3>
                  <p className="mt-1.5 text-sm text-white/65 leading-relaxed">{description}</p>
                </a>
              ))}
            </div>
          </section>

          {/* Citation, license and contact */}
          <section className={SECTION} aria-labelledby="about-cite">
            <h2 id="about-cite" className={H2}>
              Cite and reuse
            </h2>
            <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0">
                <h3 className="text-base font-semibold">How to cite</h3>
                <p className="mt-2 text-sm text-white/65 leading-relaxed">
                  If MitoSpace, its model or this explorer helps your work, please cite the paper.
                </p>
                <blockquote className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-5 text-sm text-white/80 leading-relaxed">
                  {PAPER_CITATION_TEXT}{' '}
                  <a href={PAPER_DOI_URL} {...external} className={`${TEXT_LINK} break-all`}>
                    {PAPER_DOI_URL}
                  </a>
                </blockquote>
                <div className="mt-4 flex flex-wrap gap-2">
                  <CopyTextButton text={PAPER_CITATION} label="Copy citation" />
                  <CopyTextButton text={PAPER_BIBTEX} label="Copy BibTeX" />
                </div>
                <details className="mt-4">
                  <summary className="cursor-pointer select-none text-sm text-white/60 hover:text-white/85">
                    Show BibTeX
                  </summary>
                  <pre className="mt-3 overflow-x-auto rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 font-mono text-[12px] leading-relaxed text-white/80">
                    {PAPER_BIBTEX}
                  </pre>
                </details>
              </div>
              <div className="space-y-8">
                <div>
                  <h3 className="text-base font-semibold">Data and license</h3>
                  <p className="mt-2 text-sm text-white/65 leading-relaxed">
                    The code, model weights and processed-data manifest are © 2026 The Regents of the
                    University of California. Their use is governed by the{' '}
                    <a href={`${CODE_REPO}/blob/main/LICENSE`} {...external} className={TEXT_LINK}>
                      license in the code repository
                    </a>
                    , and download instructions are in its{' '}
                    <a href={`${CODE_REPO}#data`} {...external} className={TEXT_LINK}>
                      data section
                    </a>
                    .
                  </p>
                </div>
                <div>
                  <h3 className="text-base font-semibold">Contact</h3>
                  <p className="mt-2 text-sm text-white/65 leading-relaxed">
                    For questions and bug reports,{' '}
                    <a href={`${CODE_REPO}/issues`} {...external} className={TEXT_LINK}>
                      open an issue on GitHub
                    </a>
                    . To reach the lab, visit the{' '}
                    <a href={LAB_URL} {...external} className={TEXT_LINK}>
                      Schöneberg Lab website
                    </a>
                    .
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Team */}
          <section className={SECTION} aria-labelledby="about-team">
            <h2 id="about-team" className={H2}>
              Team
            </h2>
            <p className={LEAD}>MitoSpace was built in the Schöneberg Lab.</p>
            <ul className="mt-8 flex flex-wrap gap-2">
              {AUTHORS.map(([name, equal]) => (
                <li
                  key={name}
                  className="rounded-full border border-white/[0.1] bg-white/[0.03] px-3.5 py-1.5 text-sm text-white/85"
                >
                  {name}
                  {equal && <span className="text-white/50">*</span>}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-white/50">* Equal contribution</p>
            <a href={`${LAB_URL}team`} {...external} className={`${SECONDARY} mt-8`}>
              Meet the lab
              <ArrowUpRight size={16} />
            </a>
          </section>

          {/* Closing call to action */}
          <section className="pb-16 sm:pb-24">
            <div className="rounded-2xl border border-white/[0.1] bg-white/[0.04] px-6 py-12 sm:px-12 text-center">
              <h2 className={H2}>Ready to explore?</h2>
              <p className="mt-3 text-base text-white/65">Open the atlas and watch the cells for yourself.</p>
              <Link
                to="/"
                className={`${PRIMARY} mt-7`}
                onClick={() => trackEvent('cta_click', { where: 'about_closing' })}
              >
                Open the explorer
                <ArrowRight size={16} />
              </Link>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default About;
