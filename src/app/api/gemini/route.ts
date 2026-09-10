import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

// Inisialisasi Gemini SDK
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { dataMetar } = body;

    // Kita bikin prompt khusus agar Gemini bertindak sebagai ahli meteorologi
    const prompt = `
      Anda adalah seorang ahli meteorologi penerbangan. 
      Berikut adalah data hasil ekstraksi dari laporan METAR:
      ${JSON.stringify(dataMetar, null, 2)}
      
      Tugas Anda: Berikan interpretasi dan ringkasan kondisi cuaca secara keseluruhan berdasarkan data di atas. 
      Gunakan bahasa Indonesia yang profesional dan mudah dipahami.
      Aturan ketat: Maksimal buat dalam 2 paragraf saja.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    return NextResponse.json({ text: response.text });
  } catch (error) {
    console.error("Gemini Error:", error);
    return NextResponse.json(
      { error: "Gagal menginterpretasikan data" },
      { status: 500 },
    );
  }
}
