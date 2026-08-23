/* Base layout sections */

function sectionPreview(icon) {
  return Vvveb.baseUrl + "icons/" + icon;
}

Vvveb.Sections.add("base/blank", {
  name: "Blank section",
  image: sectionPreview("section.svg"),
  html: `<section class="section_padding">
  <div class="container">
    <div class="row">
      <div class="col-lg-12">
        <p class="text-muted mb-0">Drag blocks or components here to build this section.</p>
      </div>
    </div>
  </div>
</section>`,
});

Vvveb.Sections.add("base/1-column", {
  name: "1 column",
  image: sectionPreview("grid_column.svg"),
  html: `<section class="section_padding py-4">
  <div class="container">
    <div class="row">
      <div class="col"></div>
    </div>
  </div>
</section>`,
});

Vvveb.Sections.add("base/2-columns", {
  name: "2 columns",
  image: sectionPreview("grid_column.svg"),
  html: `<section class="section_padding py-4">
  <div class="container">
    <div class="row">
      <div class="col-md-6"></div>
      <div class="col-md-6"></div>
    </div>
  </div>
</section>`,
});

Vvveb.Sections.add("base/3-columns", {
  name: "3 columns",
  image: sectionPreview("grid_column.svg"),
  html: `<section class="section_padding py-4">
  <div class="container">
    <div class="row">
      <div class="col-md-4"></div>
      <div class="col-md-4"></div>
      <div class="col-md-4"></div>
    </div>
  </div>
</section>`,
});

Vvveb.Sections.add("base/content-heading", {
  name: "Heading + text",
  image: sectionPreview("heading.svg"),
  html: `<section class="section_padding">
  <div class="container">
    <div class="row">
      <div class="col-lg-12">
        <div class="section_heading text-center mb-4">
          <h2 class="gradient_text mx-auto">Section heading</h2>
          <p class="text-center mb-0">Add your content here.</p>
        </div>
      </div>
    </div>
  </div>
</section>`,
});

Vvveb.SectionsGroup["Base"] = [
  "base/blank",
  "base/1-column",
  "base/2-columns",
  "base/3-columns",
  "base/content-heading",
];

/* Autopulse marketing sections */

Vvveb.Sections.add("autopulse/hero", {
  name: "Hero banner",
  image: sectionPreview("jumbotron.svg"),
  html: `<section class="front_banner">
  <div class="container">
    <div class="row gx-5">
      <div class="col-lg-7">
        <div class="front_banner_text">
          <h1><span>Your headline</span> goes here</h1>
          <p>Describe your product or service in one or two sentences.</p>
          <div class="d-flex front_banner_btns">
            <a class="btn btn-frontfilled" href="#">Primary action</a>
            <a class="btn btn-nofrontfilled ms-md-2 ms-1" href="#">Secondary action</a>
          </div>
        </div>
      </div>
      <div class="col-lg-5">
        <div class="front_banner_img">
          <img src="/Images/front/screenshot.png" alt="Hero image">
        </div>
      </div>
    </div>
  </div>
</section>`,
});

Vvveb.Sections.add("autopulse/content", {
  name: "Content block",
  image: sectionPreview("paragraph.svg"),
  html: `<section class="section_padding overflow-hidden">
  <div class="container">
    <div class="row">
      <div class="col-lg-12">
        <div class="section_heading text-center mb-4">
          <h2 class="gradient_text mx-auto">Section title</h2>
        </div>
      </div>
    </div>
    <div class="row justify-content-center">
      <div class="col-xl-8 col-lg-12 text-center">
        <p>Your paragraph content goes here.</p>
      </div>
    </div>
  </div>
</section>`,
});

Vvveb.SectionsGroup["Autopulse"] = [
  "autopulse/hero",
  "autopulse/content",
];
