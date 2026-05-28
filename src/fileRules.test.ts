import { describe, expect, it } from "vitest";
import { shouldConsiderFile } from "./fileRules";

describe("shouldConsiderFile", () => {
  it("excludes likely secret files", () => {
    expect(shouldConsiderFile(".env", 20)).toMatchObject({ include: false });
    expect(shouldConsiderFile("config/id_rsa", 1200)).toMatchObject({ include: false });
    expect(shouldConsiderFile("secrets/private.pem", 1200)).toMatchObject({ include: false });
  });

  it("allows safe example env files", () => {
    expect(shouldConsiderFile(".env.example", 20)).toEqual({ include: true });
    expect(shouldConsiderFile("config/.env.sample", 20)).toEqual({ include: true });
  });

  it("includes common game-dev text assets", () => {
    expect(shouldConsiderFile("Assets/Scripts/Player.cs", 1200)).toEqual({ include: true });
    expect(shouldConsiderFile("scenes/main.tscn", 1200)).toEqual({ include: true });
    expect(shouldConsiderFile("project.godot", 1200)).toEqual({ include: true });
  });
});
