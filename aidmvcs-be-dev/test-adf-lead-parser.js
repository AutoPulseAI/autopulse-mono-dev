import test from "node:test";
import assert from "node:assert/strict";

import { parseAdfLeadEmail, AdfParseError, extractRawAdfText } from "./app/lib/adfLeadParser.js";

const adf = `<?xml version="1.0" encoding="UTF-8"?>
<?ADF version="1.0"?>
<adf>
  <prospect>
    <id source="TrueCar Lead ID">1145085363</id>
    <requestdate>2026-01-01T00:18:00-08:00</requestdate>
    <vehicle interest="buy" status="used">
      <year>2024</year><make>BMW</make><model>3 Series</model>
      <vin>3MW39FS00R8E48502</vin><stock>5573P</stock><trim>330e</trim>
      <price type="quote">24845.0</price>
    </vehicle>
    <customer><contact>
      <name part="first">Tyler</name><name part="last">Davis</name>
      <email>Tyler.Davis@example.com</email><phone type="voice">555-1234</phone>
    </contact></customer>
  </prospect>
</adf>`;

test("regular email is not treated as ADF", () => {
  assert.equal(parseAdfLeadEmail("Hello, I am interested in this vehicle."), null);
});

test("ADF customer and vehicle details are extracted locally", () => {
  const result = parseAdfLeadEmail(adf);
  assert.equal(result.name, "Tyler Davis");
  assert.equal(result.email, "Tyler.Davis@example.com");
  assert.equal(result.phone, "555-1234");
  assert.equal(result.source, "TrueCar Lead ID");
  assert.equal(result.externalLeadId, "1145085363");
  assert.deepEqual(result.vehicle, {
    year: "2024",
    make: "BMW",
    model: "3 Series",
    vin: "3MW39FS00R8E48502",
    stock: "5573P",
    trim: "330e",
    price: "24845.0",
    interest: "buy",
    condition: "used",
  });
});

test("HTML-escaped ADF is extracted", () => {
  const escaped = adf.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  assert.equal(parseAdfLeadEmail(escaped).externalLeadId, "1145085363");
});

// parseAdfLeadEmail's own contract: fail loudly on unparseable ADF rather than
// silently returning a partial/garbage lead. It's up to the caller (emailWorker.js)
// to decide what "loudly" means downstream - today that's catching AdfParseError
// and falling back to the n8n pipeline, so a malformed payload still gets a
// best-effort AI extraction instead of being dropped.
test("malformed ADF throws AdfParseError instead of returning a partial lead", () => {
  assert.throws(
    () => parseAdfLeadEmail("<adf><prospect></prospect>"),
    (err) => err instanceof AdfParseError && /missing its closing/.test(err.message)
  );
});

test("stray unescaped ampersand in comments is sanitized before parsing", () => {
  const messy = `<adf><prospect>
    <id source="Vendor">123</id>
    <vehicle interest="buy"><year>2023</year><make>Ford</make><model>F-150</model></vehicle>
    <customer>
      <contact><email>buyer@example.com</email></contact>
      <comments>Interested, saw it at Bob & Sons Motors</comments>
    </customer>
  </prospect></adf>`;

  const result = parseAdfLeadEmail(messy);
  assert.equal(result.email, "buyer@example.com");
  assert.equal(result.comments, "Interested, saw it at Bob & Sons Motors");
});

test("unclosed <br> tag in comments is sanitized before parsing", () => {
  const messy = `<adf><prospect>
    <id source="Vendor">124</id>
    <vehicle interest="buy"><year>2023</year><make>Ford</make><model>F-150</model></vehicle>
    <customer>
      <contact><email>buyer2@example.com</email></contact>
      <comments>Line one<br>Line two</comments>
    </customer>
  </prospect></adf>`;

  const result = parseAdfLeadEmail(messy);
  assert.equal(result.email, "buyer2@example.com");
  assert.match(result.comments, /Line one/);
  assert.match(result.comments, /Line two/);
});

test("vendor name is used as source when no provider is present", () => {
  const vendorOnly = `<adf><prospect>
    <id source="Website">125</id>
    <vehicle interest="buy"><year>2022</year><make>Honda</make><model>Civic</model></vehicle>
    <customer><contact><email>buyer3@example.com</email></contact></customer>
    <vendor><vendorname>ABC Motors</vendorname></vendor>
  </prospect></adf>`;

  const result = parseAdfLeadEmail(vendorOnly);
  assert.equal(result.source, "ABC Motors");
});

test("truly broken ADF (no prospect) throws AdfParseError", () => {
  assert.throws(
    () => parseAdfLeadEmail("<adf><customer><contact><email>a@b.com</email></contact></customer></adf>"),
    (err) => err instanceof AdfParseError && /does not contain a prospect/.test(err.message)
  );
});

test("extractRawAdfText returns the full tail from <adf onward for well-formed ADF", () => {
  const raw = extractRawAdfText(adf);
  assert.match(raw, /^<adf>/);
  assert.match(raw, /<\/adf>\s*$/);
});

test("extractRawAdfText returns the raw tail even without a closing </adf> tag", () => {
  const broken = "Some preamble text\n<adf><prospect><id>1</id>";
  const raw = extractRawAdfText(broken);
  assert.equal(raw, "<adf><prospect><id>1</id>");
  // Unlike extractAdfBlock/parseAdfLeadEmail, this must NOT throw on a missing
  // closing tag - it's a best-effort capture, not a parse.
  assert.throws(() => parseAdfLeadEmail(broken), AdfParseError);
});

test("extractRawAdfText returns null for non-ADF content", () => {
  assert.equal(extractRawAdfText("Hello, I am interested in this vehicle."), null);
});
