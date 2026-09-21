---
title: ""
summary: ""
date: "2022-10-24"
type: "landing"
sections:
  # ① 封面（照片 2/3 屏 + 标题）+ 图下的介绍与按钮 + 研究方向胶囊
  - block: markdown
    content:
      title: ""
      subtitle: ""
      text: |-
          <div class="lab-hero">
          <img class="lab-hero-bg" src="/uploads/home/2021.jpg" alt="Poultry Breeding Innovation Team" />
          <div class="lab-hero-shade">
          </div>
          <div class="lab-hero-inner">
          <h1 class="lab-hero-title">Poultry Breeding Innovation Team</h1>
          <div class="lab-hero-sub">Waterfowl genetics, breeding and molecular improvement</div>
          </div>
          </div>
          <div class="lab-lead">
          <div class="lab-lead-intro">
          <p>We focus on waterfowl genetics, breeding, and molecular improvement, with research spanning genetic resources, genetic mechanisms, genomics, and precision breeding. Our work aims to elucidate the genetic basis of economically important traits and to develop innovative technologies and approaches for waterfowl breeding.</p>
          <p>By integrating genetic breeding, genomics, bioinformatics, and protein design, we seek to identify favorable genetic variants and uncover key molecular mechanisms underlying important traits. Our ultimate goal is to translate genetic discoveries into innovative strategies for precision breeding and the sustainable improvement of waterfowl.</p>
          <p class="lab-lead-cta">We welcome passionate and motivated researchers to join us.</p>
          </div>
          <div class="lab-lead-actions">
          <a class="lab-btn" href="/research/">Research Areas</a>
          <a class="lab-btn lab-btn-ghost" href="/publications/">Publications</a>
          </div>
          </div>
          <div class="lab-areas">
          <div class="lab-areas-title">Research Areas</div>
          <div class="lab-pills">
          <a class="lab-pill" href="/research/">Functional Gene Research</a> <a class="lab-pill" href="/research/">Molecular Design</a> <a class="lab-pill" href="/research/">Single-cell Omics</a> <a class="lab-pill" href="/research/">Quantitative Genetics</a> <a class="lab-pill" href="/research/">Intelligent Phenotyping</a>
          </div>
          </div>
    design:
      columns: "1"
  # ② 最新论文：自动抓取 publications 里最新的 6 篇
  - block: latest-papers
    content:
      title: "Latest Publications"
      count: 6
      folder: publications
    design:
      columns: "1"
---
