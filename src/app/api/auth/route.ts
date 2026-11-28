import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const inputPassword =
      typeof body?.password === "string" ? body.password : "";
    const validPassword = process.env.APP_ACCESS_PASSWORD;

    if (!validPassword) {
      return NextResponse.json(
        { ok: false, message: "APP_ACCESS_PASSWORD belum disetel di server." },
        { status: 500 },
      );
    }

    if (inputPassword === validPassword) {
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { ok: false, message: "Password salah." },
      { status: 401 },
    );
  } catch {
    return NextResponse.json(
      { ok: false, message: "Request tidak valid." },
      { status: 400 },
    );
  }
}
