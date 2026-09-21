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
          <img class="lab-hero-bg" src="/uploads/home/2021.jpg" alt="家禽育种创新团队" />
          <div class="lab-hero-shade">
          </div>
          <div class="lab-hero-inner">
          <h1 class="lab-hero-title">家禽育种创新团队</h1>
          <div class="lab-hero-sub">水禽遗传、育种与分子改良</div>
          </div>
          </div>
          <div class="lab-lead">
          <div class="lab-lead-intro">
          <p>我们聚焦水禽遗传、育种与分子改良，研究覆盖遗传资源、遗传机制、基因组学与精准育种。团队致力于阐明重要经济性状的遗传基础，并发展水禽育种的新技术与新方法。</p>
          <p>通过整合遗传育种、基因组学、生物信息学与蛋白质设计，我们寻找优异基因变异、解析重要性状的关键分子机制，把遗传学发现转化为精准育种与可持续发展的新策略。</p>
          <p class="lab-lead-cta">欢迎有热情、有想法的同学加入我们。</p>
          </div>
          <div class="lab-lead-actions">
          <a class="lab-btn" href="/zh/research/">研究方向</a>
          <a class="lab-btn lab-btn-ghost" href="/zh/publications/">论文发表</a>
          </div>
          </div>
          <div class="lab-areas">
          <div class="lab-areas-title">研究方向</div>
          <div class="lab-pills">
          <a class="lab-pill" href="/zh/research/">功能基因研究</a> <a class="lab-pill" href="/zh/research/">分子设计</a> <a class="lab-pill" href="/zh/research/">单细胞组学</a> <a class="lab-pill" href="/zh/research/">数量遗传学</a> <a class="lab-pill" href="/zh/research/">智能表型测定</a>
          </div>
          </div>
    design:
      columns: "1"
  # ② 最新论文：自动抓取 publications 里最新的 6 篇
  - block: latest-papers
    content:
      title: "最新论文"
      count: 6
      folder: publications
    design:
      columns: "1"
---
