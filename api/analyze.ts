import { config } from "dotenv";

declare const process: {
  env: Record<string, string | undefined>;
};

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

type GeminiAnalysis = {
  risk?: string;
  detective?: string;
  indicators?: Array<{ quote?: string; reason?: string }>;
  actions?: string[];
  psychology?: {
    manipulation?: string;
    advice?: string;
  } | null;
};

function extractJsonObject(text: string) {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Gemini did not return a JSON object");
  }

  return cleaned.slice(firstBrace, lastBrace + 1);
}

function normalizeAnalysis(data: GeminiAnalysis) {
  const allowedRisks = new Set(["An toàn", "Nghi ngờ", "Nguy hiểm"]);
  const risk = allowedRisks.has(String(data.risk)) ? String(data.risk) : "Nghi ngờ";

  return {
    risk,
    detective: typeof data.detective === "string" ? data.detective.trim() : "",
    indicators: Array.isArray(data.indicators)
      ? data.indicators
          .filter((item) => item && typeof item.quote === "string" && item.quote.trim())
          .slice(0, 4)
          .map((item) => ({
            quote: String(item.quote).trim(),
            reason: typeof item.reason === "string" ? item.reason.trim() : "",
          }))
      : [],
    actions: Array.isArray(data.actions)
      ? data.actions.filter((item) => typeof item === "string" && item.trim()).slice(0, 3)
      : [],
    psychology: data.psychology && typeof data.psychology === "object"
      ? {
          manipulation: typeof data.psychology.manipulation === "string" ? data.psychology.manipulation.trim() : "",
          advice: typeof data.psychology.advice === "string" ? data.psychology.advice.trim() : "",
        }
      : null,
  };
}

async function analyzeHandler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
  }

  const message = req.body?.message;
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing message" });
  }

  const prompt = `
Bạn là ScamCheck, công cụ giáo dục và chống lừa đảo online cho người lớn tuổi Việt Nam.

Hãy phân tích tin nhắn sau:
"""${message}"""

Yêu cầu bắt buộc:
- Xưng hô bằng "bạn", "tôi"
- Trả lời bằng tiếng Việt rõ ràng, dễ hiểu cho người từ 40 tuổi trở lên.
- Không bịa thông tin ngoài nội dung tin nhắn.
- risk chỉ được là một trong ba giá trị: "An toàn", "Nghi ngờ", "Nguy hiểm".
- Không đánh giá "Nghi ngờ" chỉ vì tin nhắn có khuyến mãi, tài khoản, nạp tiền, ưu đãi, hoặc thời hạn "hôm nay".
- Nếu tin nhắn chỉ thông báo ưu đãi và hướng người dùng xem trong app chính thức/website chính thức đã biết, không có link lạ, số điện thoại cá nhân, Zalo/Telegram, OTP, mật khẩu, CCCD, phí trước, hoặc chuyển tiền ngoài kênh chính thức, hãy ưu tiên "An toàn".
- Nếu nội dung là cảnh báo/phòng tránh lừa đảo, có các cụm như "cảnh báo", "khuyến cáo", "chiêu trò", "tuyệt đối không", "không làm theo", và không yêu cầu người đọc bấm link, gọi số lạ, cung cấp thông tin, đăng nhập hoặc chuyển tiền, hãy đánh giá "An toàn". Đây là nội dung giáo dục, không phải tin lừa đảo.
- Đánh giá "Nghi ngờ" hoặc "Nguy hiểm" khi có bằng chứng rõ như link/domain lạ, link rút gọn (bit.ly, tinyurl, t.co, goo.gl, is.gd, cutt.ly, rebrand.ly,...), yêu cầu đăng nhập ngoài app chính thức, gửi OTP/mật khẩu/CCCD, chuyển tiền/đóng phí, liên hệ số cá nhân/Zalo/Telegram, đe dọa khóa tài khoản, hoặc tạo áp lực bất thường. Link rút gọn không tự động là "Nguy hiểm", nhưng là dấu hiệu che giấu đích đến; nếu đi kèm nhận thưởng, xác minh tài khoản, đăng nhập, chuyển tiền hoặc thời hạn gấp thì ít nhất phải là "Nghi ngờ".
- Ví dụ an toàn: "Viettel thong bao: Tai khoan cua ban duoc tang 50% gia tri the nap khi nap tien qua ung dung MyViettel duy nhat trong ngay hom nay. Chi tiet xem tai app MyViettel." => risk "An toàn", indicators [].
- Ví dụ an toàn: "[BO CONG AN] CANH BAO: Hien nay co chieu tro gia mao cong an goi dien thong bao phat nguoi hoac doa bat giam lien quan den rua tien nham yeu cau nguoi dan chuyen tien vao tai khoan ca nhan de chiem doat. Tuyet doi khong lam theo!" => risk "An toàn", indicators [].
- Ví dụ nguy hiểm: "Viettel tang 50%, truy cap http://myviettel-khuyenmai.cc de dang nhap nhan thuong" => risk "Nguy hiểm".
- detective là lời của nhân vật "Thám tử phân tích": 1 đoạn tối đa 80 chữ, đi thẳng vào bằng chứng chính.
- indicators là tối đa 5 dấu hiệu nghi ngờ. quote phải là đoạn có thật trong tin nhắn. Nếu risk là "An toàn", indicators là mảng rỗng.
- actions là tối đa 4 việc nên làm, mỗi việc tối đa 40 chữ, cụ thể và an toàn. Chỉ đưa actions khi có rủi ro lừa đảo hoặc có bước an toàn thật sự quan trọng. Nếu risk là "An toàn" và không có việc phòng tránh lừa đảo cần làm, actions phải là mảng rỗng []. Không đưa lời khuyên đời sống không liên quan đến lừa đảo.
- psychology là lời của nhân vật "Cô tâm lý": nếu có rủi ro, manipulation ngắn gọn và advice có thể dài tối đa 100 chữ, trấn an người dùng, không làm họ xấu hổ. Nếu risk là "An toàn", psychology là null.
- Chỉ trả về đúng một JSON object hợp lệ bắt đầu bằng { và kết thúc bằng }. Không markdown, không code fence, không giải thích ngoài JSON.

Cấu trúc JSON:
{
  "risk": "An toàn | Nghi ngờ | Nguy hiểm",
  "detective": "lời phân tích của Thám tử",
  "indicators": [
    {
      "quote": "đoạn đáng ngờ có thật trong tin nhắn",
      "reason": "lý do đáng ngờ"
    }
  ],
  "actions": [
    "việc nên làm 1",
    "việc nên làm 2",
    "việc nên làm 3"
  ],
  "psychology": {
    "manipulation": "thủ đoạn tâm lý",
    "advice": "lời khuyên bình tĩnh của Cô tâm lý"
  }
}
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const geminiResponse = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1500,
        responseMimeType: "application/json",
      },
    }),
  });

  const raw = await geminiResponse.text();

  if (!geminiResponse.ok) {
    return res.status(502).json({ error: "Gemini API error", detail: raw });
  }

  const geminiData = JSON.parse(raw);
  const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text || typeof text !== "string") {
    return res.status(502).json({ error: "Gemini returned empty result" });
  }

  try {
    try {
      return res.status(200).json(normalizeAnalysis(JSON.parse(text)));
    } catch {
      return res.status(200).json(normalizeAnalysis(JSON.parse(extractJsonObject(text))));
    }
  } catch (error) {
    console.error("Could not parse Gemini response", {
      error: error instanceof Error ? error.message : String(error),
      preview: text.slice(0, 500),
    });

    return res.status(502).json({
      error: "Gemini returned invalid JSON",
      detail: text.slice(0, 500),
    });
  }
}
export default async function handler(req: any, res: any) {
  try {
    return await analyzeHandler(req, res);
  } catch (error) {
    console.error("Analyze API crashed", error);
    return res.status(500).json({
      error: "Analyze API crashed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}









