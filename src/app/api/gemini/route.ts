import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { dataMetar, timezone, period } = body;

    const systemPrompt = `
      Anda adalah seorang ahli meteorologi penerbangan. 
      Berikut adalah data hasil ekstraksi dari laporan METAR untuk periode ${period}:
      ${JSON.stringify(dataMetar, null, 2)}
      
      Tugas Anda: Berikan interpretasi dan ringkasan kondisi cuaca secara keseluruhan berdasarkan data di atas. 
      Gunakan bahasa Indonesia yang profesional dan mudah dipahami.
      Aturan ketat: 
      1. Maksimal buat dalam 2 paragraf saja.
      2. JANGAN gunakan format markdown, JANGAN gunakan simbol asterisk (*), dan JANGAN gunakan simbol dolar ($).
      3. Gunakan bahasa yang formal dan profesional, hindari bahasa santai atau slang.
      4. Tulis murni menggunakan plain text (teks biasa).
      5. Khusus untuk derajat celcius, gunakan simbol °C.
      6. WAKTU DAN TANGGAL: Pengguna saat ini melihat data dalam zona waktu ${timezone}. 
         Gunakan waktu tersebut dalam analisis Anda (jangan gunakan Z atau UTC jika zona waktunya WITA).
         Saat menyebutkan tanggal di paragraf, WAJIB tuliskan LENGKAP dengan bulan dan tahun (contoh: 11 September 2026).
      
      Berikan jawaban atau analisis profesional Anda:
    `;

    const interaction = await (ai as any).interactions.create({
      model: "gemini-3.6-flash",
      input: systemPrompt,
    });

    return NextResponse.json({ reply: interaction.output_text });
  } catch (error: any) {
    console.error("Gemini API Error Detail:", error?.message || error);
    return NextResponse.json(
      { reply: `Gagal: ${error?.message || "Kesalahan Server."}` },
      { status: 500 },
    );
  }
}
