require("dotenv").config();
const { upsertImportedShortIoLink } = require("./db");
const { getPool, ensureSchema } = require("./db"); // Wait, getPool is not exported. Let me just use the imported function.

async function run() {
  try {
    const payload = {
        userId: 1, // assumption: user 1 exists
        title: "Test",
        originalUrl: "https://docs.google.com/spreadsheets/d/1ZT6H8cT5K3-MEJk...",
        shortUrl: "https://s.pmkitera.com/PengumumanPanitiaPelayanPIEC2026",
        shortCode: "PengumumanPanitiaPelayanPIEC2026",
        providerLinkId: "dummy_12345",
        customSlug: "PengumumanPanitiaPelayanPIEC2026",
        isActive: true,
        expiresAt: null,
        createdAt: new Date(),
        clickCount: 0,
    };
    
    console.log("Calling upsertImportedShortIoLink...");
    const result = await upsertImportedShortIoLink(payload);
    console.log("Success:", result);
  } catch (error) {
    console.error("Error executing upsertImportedShortIoLink:", error);
  } finally {
    process.exit(0);
  }
}

run();
