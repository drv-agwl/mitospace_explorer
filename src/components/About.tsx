import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Microscope,
  Cpu,
  Users,
  ExternalLink,
  Layers3,
  Sparkles,
  Clapperboard,
  Info,
} from 'lucide-react';
import Header from './Header';
import Footer from './Footer';

// Match VisualizerControls / explorer chrome: h-9, rounded-lg, same border weights.
const PILL_BASE =
  'inline-flex items-center gap-2 h-9 px-3 rounded-lg text-sm font-medium border transition-all duration-150';
const PILL_IDLE =
  'bg-white/[0.04] border-white/[0.08] text-white/85 hover:bg-white/[0.07] hover:border-white/[0.14]';
const PANEL =
  'rounded-lg border border-white/[0.08] bg-white/[0.04] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]';

const About: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <Header />
      <main className="flex-grow border-t border-white/[0.06]">
        <div className="max-w-[1920px] mx-auto px-6 sm:px-8 lg:px-12">
          <div className="max-w-3xl mx-auto w-full pb-20 lg:pb-28">
            {/* Back — same pill language as toolbar */}
            <Link
              to="/"
              className={`${PILL_BASE} ${PILL_IDLE} mt-8 mb-10 lg:mb-14 group`}
            >
              <ArrowLeft size={16} className="text-white/55 group-hover:-translate-x-0.5 transition-transform shrink-0" />
              Back to explorer
            </Link>

            {/* Hero */}
            <header className="mb-16 lg:mb-20 pb-16 lg:pb-20 border-b border-white/[0.08]">
              <p className="text-xs text-white/45 font-medium tracking-wide uppercase mb-3">
                Schöneberg Lab
              </p>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-white leading-tight mb-6">
                About MitoSpace Explorer
              </h1>
              <p className="text-base sm:text-lg text-white/60 leading-relaxed max-w-2xl mb-8">
                A browser-based atlas of mitochondrial phenotypes under drug perturbation, built from
                high-resolution 4D lattice light-sheet microscopy data. MitoSpace organizes single-cell
                mitochondrial behaviors into an interactive latent space for exploration, comparison, and
                biological interpretation.
              </p>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                <Link
                  to="/"
                  className={`${PILL_BASE} px-4 bg-white text-black border-white hover:bg-gray-100 font-semibold`}
                >
                  Open explorer
                  <ArrowRight size={16} strokeWidth={2.5} />
                </Link>
                <a
                  href="https://www.schoeneberglab.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${PILL_BASE} ${PILL_IDLE}`}
                >
                  Visit lab website
                  <ExternalLink size={14} className="opacity-70" />
                </a>
              </div>
            </header>

            {/* At a glance — three tiles share one neutral icon treatment (no lone teal tile). */}
            <section className="mb-16 lg:mb-20" aria-labelledby="about-glance">
              <h2
                id="about-glance"
                className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40 mb-5"
              >
                At a glance
              </h2>
              <div className="grid sm:grid-cols-3 gap-3">
                <div className={`${PANEL} p-5`}>
                  <div className="w-9 h-9 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-3">
                    <Layers3 size={18} className="text-white/55" strokeWidth={1.75} />
                  </div>
                  <h3 className="text-sm font-semibold text-white mb-2">Interactive atlas</h3>
                  <p className="text-sm text-white/55 leading-relaxed">
                    Each point represents a single-cell 4D mitochondrial movie embedded in latent space.
                    Explore phenotypic relationships across perturbations and inspect individual cells in
                    detail.
                  </p>
                </div>
                <div className={`${PANEL} p-5`}>
                  <div className="w-9 h-9 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-3">
                    <Clapperboard size={18} className="text-white/55" strokeWidth={1.75} />
                  </div>
                  <h3 className="text-sm font-semibold text-white mb-2">Condition Overview</h3>
                  <p className="text-sm text-white/55 leading-relaxed">
                    Representative single-cell movies provide a rapid overview of mitochondrial phenotypes
                    across drug conditions and cellular states.
                  </p>
                </div>
                <div className={`${PANEL} p-5`}>
                  <div className="w-9 h-9 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-3">
                    <Sparkles size={18} className="text-white/55" strokeWidth={1.75} />
                  </div>
                  <h3 className="text-sm font-semibold text-white mb-2">Semantic axes</h3>
                  <p className="text-sm text-white/55 leading-relaxed">
                    Visualize continuous gradients of mitochondrial features directly within the embedding
                    space and relate learned representations to interpretable biological properties.
                  </p>
                </div>
              </div>

              {/* UMAP: how the plot relates to embeddings */}
              <div className={`mt-4 ${PANEL} p-4 flex gap-3`}>
                <div className="shrink-0 w-9 h-9 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
                  <Info size={16} className="text-white/50" strokeWidth={1.75} />
                </div>
                <div className="min-w-0 text-sm text-white/55 leading-relaxed">
                  <p className="font-medium text-white/80 mb-1.5">Visualization note</p>
                  <p>
                    One marker per cell. The layout is{' '}
                    <span className="text-white/75">UMAP</span>: for each cell, coordinates come from
                    projecting its <span className="text-white/75">2048 dimensional</span> embedding into
                    the <span className="text-white/75">low dimensional</span> space you see in the
                    explorer.
                  </p>
                </div>
              </div>
            </section>

            <div className="border-t border-white/[0.08] mb-16 lg:mb-20" aria-hidden />

            {/* What is MitoSpace? */}
            <section className="mb-16 lg:mb-20" aria-labelledby="about-mitospace">
              <div className="flex flex-col sm:flex-row gap-5 sm:gap-8">
                <div className="shrink-0">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-white/[0.06] border border-white/[0.08]">
                    <Microscope size={22} className="text-white/70" strokeWidth={1.5} />
                  </div>
                </div>
                <div className="min-w-0">
                  <h2
                    id="about-mitospace"
                    className="text-xl sm:text-2xl font-semibold tracking-tight text-white mb-4"
                  >
                    What is MitoSpace?
                  </h2>
                  <div className="space-y-4 text-white/60 leading-relaxed text-sm sm:text-base">
                    <p>
                      <span className="text-white font-medium">MitoSpace</span> is a self-supervised
                      representation space learned from high-resolution 4D mitochondrial imaging data. Each
                      point in the atlas corresponds to a single-cell mitochondrial movie captured using
                      lattice light-sheet microscopy under a defined perturbation condition.
                    </p>
                    <p>
                      The embedding space organizes cells according to shared spatiotemporal mitochondrial
                      phenotypes, enabling comparison of drug responses, visualization of phenotypic
                      gradients, and exploration of biological relationships across perturbations. The
                      explorer connects these learned representations with classical mitochondrial features,
                      allowing users to move between raw imaging data, interpretable measurements, and latent
                      representations within a unified interface.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* How it's built */}
            <section className="mb-16 lg:mb-20" aria-labelledby="about-tech">
              <div className="flex flex-col sm:flex-row gap-5 sm:gap-8">
                <div className="shrink-0">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-white/[0.06] border border-white/[0.08]">
                    <Cpu size={22} className="text-white/70" strokeWidth={1.5} />
                  </div>
                </div>
                <div className="min-w-0">
                  <h2
                    id="about-tech"
                    className="text-xl sm:text-2xl font-semibold tracking-tight text-white mb-4"
                  >
                    {"How it's built"}
                  </h2>
                  <p className="text-white/60 leading-relaxed text-sm sm:text-base mb-5">
                    MitoSpace is built using a self-supervised contrastive learning framework trained on
                    large-scale 4D lattice light-sheet microscopy datasets of mitochondria. The model learns
                    compact representations of mitochondrial morphology and dynamics directly from raw
                    imaging data without requiring manual annotation. These embeddings are combined with
                    image-derived mitochondrial features and projected into interactive visualizations for
                    downstream analysis.
                  </p>
                  <ul className="space-y-2.5 text-sm text-white/55">
                    {[
                      'Trained on ~40,000 single-cell 4D mitochondrial movies spanning diverse pharmacological perturbations.',
                      'The web explorer uses optimized embeddings and media representations for interactive visualization performance.',
                    ].map((line) => (
                      <li key={line} className="flex gap-2.5 pl-0.5">
                        <span className="mt-2 h-1 w-1 rounded-full bg-white/35 shrink-0" aria-hidden />
                        <span className="leading-relaxed">{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            <div className="border-t border-white/[0.08] mb-14 lg:mb-16" aria-hidden />

            {/* Team */}
            <section aria-labelledby="about-team">
              <div className="flex flex-col sm:flex-row gap-5 sm:gap-8">
                <div className="shrink-0">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-white/[0.06] border border-white/[0.08]">
                    <Users size={22} className="text-white/70" strokeWidth={1.5} />
                  </div>
                </div>
                <div className="min-w-0">
                  <h2 id="about-team" className="text-xl sm:text-2xl font-semibold tracking-tight text-white mb-2">
                    Team
                  </h2>
                  <p className="text-xs text-white/45 mb-5 max-w-xl">
                    Equal contribution denoted by *. Listed in collaboration order.
                  </p>
                  <p className="text-white/70 text-sm sm:text-base leading-relaxed mb-6">
                    Dhruv Agarwal*, Zichen Wang*, Eric Arkfeld*, Andre Modolo*, Parth Natekar*,
                    Hiroyuki Hakozaki*, Mehul Arora, Siddharth Nahar, Manav Doshi, Gillian McMahon,
                    Johannes Schöneberg
                  </p>
                  <a
                    href="https://www.schoeneberglab.org/team"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${PILL_BASE} ${PILL_IDLE}`}
                  >
                    Meet the lab
                    <ExternalLink size={14} className="opacity-70" />
                  </a>
                </div>
              </div>
            </section>

            {/* Closing CTA — same panel as drug strip / toolbar secondary surfaces */}
            <div className={`mt-12 lg:mt-16 ${PANEL} p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5`}>
              <div>
                <p className="text-sm font-medium text-white mb-1">Ready to explore?</p>
                <p className="text-sm text-white/50">Explore the latent space of mitochondrial phenotypes.</p>
              </div>
              <Link
                to="/"
                className={`${PILL_BASE} px-4 bg-white text-black border-white hover:bg-gray-100 font-semibold shrink-0 justify-center`}
              >
                Open explorer
                <ArrowRight size={16} strokeWidth={2.5} />
              </Link>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default About;
