import { describe, it, expect } from "vitest";
import { publicMediaPath, publicMediaOrigin, rewritePublicMediaUrl } from "../lib/publicMedia";

const PROJECT = "https://jaatgiqigsmjodqgaocl.supabase.co";
const storage = (path: string) => `${PROJECT}/storage/v1/object/public/${path}`;

describe("publicMediaPath", () => {
  it("accepts a standard bucket/file path", () => {
    expect(publicMediaPath("images/photo.jpg")).toBe("images/photo.jpg");
  });
  it("accepts a single-segment path (file at bucket root)", () => {
    expect(publicMediaPath("photo.jpg")).toBe("photo.jpg");
  });
  it("percent-encodes spaces in filenames", () => {
    expect(publicMediaPath("images/my photo.jpg")).toBe("images/my%20photo.jpg");
  });
  it("rejects dot traversal", () => {
    expect(publicMediaPath("images/../secret")).toBeNull();
    expect(publicMediaPath("../etc/passwd")).toBeNull();
  });
  it("rejects empty segments", () => {
    expect(publicMediaPath("images//double.jpg")).toBeNull();
  });
  it("rejects control characters", () => {
    expect(publicMediaPath("images/\x00evil")).toBeNull();
  });
  it("rejects nested percent-encoding", () => {
    expect(publicMediaPath("images%2Fphoto%2525.jpg")).toBeNull();
  });
});

describe("publicMediaOrigin", () => {
  it("returns the origin for a valid Supabase URL", () => {
    expect(publicMediaOrigin(PROJECT)).toBe(PROJECT);
  });
  it("returns null for undefined", () => {
    expect(publicMediaOrigin(undefined)).toBeNull();
  });
  it("returns null for a URL with a path", () => {
    expect(publicMediaOrigin(`${PROJECT}/storage`)).toBeNull();
  });
});

describe("rewritePublicMediaUrl", () => {
  it("rewrites a Supabase storage URL to the proxy path", () => {
    expect(rewritePublicMediaUrl(storage("images/cover.jpg"), PROJECT))
      .toBe("/media/public/images/cover.jpg");
  });
  it("rewrites even when projectUrl env is missing", () => {
    expect(rewritePublicMediaUrl(storage("images/cover.jpg"), undefined))
      .toBe("/media/public/images/cover.jpg");
  });
  it("rewrites a single-segment filename (file at bucket root)", () => {
    expect(rewritePublicMediaUrl(storage("cover.jpg"), PROJECT))
      .toBe("/media/public/cover.jpg");
  });
  it("rewrites a path with spaces in the filename", () => {
    expect(rewritePublicMediaUrl(storage("images/my%20photo.jpg"), PROJECT))
      .toBe("/media/public/images/my%20photo.jpg");
  });
  it("does NOT rewrite Pexels URLs", () => {
    const url = "https://images.pexels.com/photos/1234/photo.jpeg";
    expect(rewritePublicMediaUrl(url, PROJECT)).toBe(url);
  });
  it("does NOT rewrite non-Supabase URLs", () => {
    const url = "https://cdn.example.com/image.jpg";
    expect(rewritePublicMediaUrl(url, PROJECT)).toBe(url);
  });
  it("does NOT rewrite signed URLs", () => {
    const url = `${storage("private/doc.pdf")}?token=abc123`;
    expect(rewritePublicMediaUrl(url, PROJECT)).toBe(url);
  });
  it("does NOT rewrite URL from a different Supabase project", () => {
    const otherUrl = "https://other.supabase.co/storage/v1/object/public/images/x.jpg";
    expect(rewritePublicMediaUrl(otherUrl, PROJECT)).toBe(otherUrl);
  });
  it("returns the raw URL for empty input", () => {
    expect(rewritePublicMediaUrl("", PROJECT)).toBe("");
  });
});
