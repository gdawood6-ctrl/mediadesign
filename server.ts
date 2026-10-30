import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '15mb' }));

// Health and AI status check (never exposes secret keys)
app.get('/api/health', (req, res) => {
  const hasKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim() !== '');
  res.json({
    status: 'ok',
    hasGeminiKey: hasKey,
    timestamp: new Date().toISOString()
  });
});

// Structured AI Carousel copy generation
app.post('/api/generate-carousel', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim() === '' || apiKey === 'MY_GEMINI_API_KEY') {
      return res.status(400).json({
        error: 'NO_API_KEY',
        message: 'Gemini API key is not configured in Settings > Secrets. You can still create and edit carousels manually or use pre-made templates.'
      });
    }

    const {
      topic,
      slideCount = 5,
      language = 'en',
      tone = 'professional',
      targetAudience = 'general creators',
      authorHandle = '@carouselstudio'
    } = req.body;

    if (!topic || typeof topic !== 'string') {
      return res.status(400).json({ error: 'Topic is required.' });
    }

    const clampedSlideCount = Math.min(Math.max(Number(slideCount) || 5, 3), 10);
    const isArabic = language === 'ar';

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const systemPrompt = isArabic
      ? `أنت خبير محتوى وكاتب إعلاني ومصمم عروض كاروسيل احترافية لمنصات التواصل الاجتماعي (إنستغرام، لينكد إن).
مهمتك كتابة محتوى كاروسيل عالي التفاعل وجذاب ومقنع باللغة العربية الفصحى السليمة والحديثة.
القواعد:
1. الشريحة الأولى (Slide 1): خطاف قوي جداً (Hook) يثير الفضول ويدفع للقراءة.
2. الشرائح الوسطى: نصائح عملية، خطوات سريعة، نقاط واضحة سهلة القراءة ومباشرة، بدون حشو.
3. الشريحة الأخيرة: دعوة واضحة لاتخاذ إجراء (Call to Action - CTA) مثل "احفظ المنشور"، "شارك رأيك في التعليقات"، "تابع للمزيد".
4. كتابة كابشن كامل ومميز جاهز للنشر مع هاشتاغات ملائمة.`
      : `You are an elite copywriter and social media strategist specializing in high-engagement Instagram and LinkedIn carousels.
Your job is to generate high-converting, punchy, visually structured carousel slides.
Rules:
1. Slide 1 must be an irresistible Hook that stops the scroll.
2. Middle slides must deliver punchy, actionable value with concise headers and bullet/short body points (no fluff or long paragraphs).
3. The final slide must feature a strong Call-To-Action (Save for later, follow, comment your thoughts).
4. Provide a full engaging caption ready to paste on social media with curated hashtags.`;

    const userPrompt = isArabic
      ? `الموضوع: "${topic}"
عدد الشرائح المطلوب: ${clampedSlideCount}
النبرة: ${tone}
الجمهور المستهدف: ${targetAudience}
اسم المستخدم أو الحساب: ${authorHandle}
قم بإنشاء محتوى الكاروسيل الكامل مع الكابشن والهاشتاغات بالتنسيق المطلوب بالضبط.`
      : `Topic: "${topic}"
Requested Slide Count: ${clampedSlideCount}
Tone: ${tone}
Target Audience: ${targetAudience}
Author Handle: ${authorHandle}
Generate the complete structured carousel slides with caption and hashtags.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: 'Overall title or concept of the carousel',
            },
            caption: {
              type: Type.STRING,
              description: 'Full Instagram/LinkedIn caption text with line breaks and emoji',
            },
            hashtags: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'List of 5 to 10 relevant hashtags without # symbol',
            },
            slides: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  slideNumber: { type: Type.INTEGER },
                  tag: {
                    type: Type.STRING,
                    description: 'Short upper tag e.g. "HOOK", "STEP 01", "KEY TAKEAWAY", "نصيحة 1"',
                  },
                  heading: {
                    type: Type.STRING,
                    description: 'Main bold headline for the slide',
                  },
                  subheading: {
                    type: Type.STRING,
                    description: 'Short supporting headline or tagline (optional)',
                  },
                  body: {
                    type: Type.STRING,
                    description: 'Concise body text or 2-3 short bullet points',
                  },
                  swipePrompt: {
                    type: Type.STRING,
                    description: 'Swipe indicator prompt e.g. "Swipe ->" or "اسحب للمزيد"',
                  },
                },
                required: ['slideNumber', 'tag', 'heading', 'body'],
              },
            },
          },
          required: ['title', 'caption', 'hashtags', 'slides'],
        },
      },
    });

    const rawText = response.text;
    if (!rawText) {
      throw new Error('Empty response from AI model');
    }

    const parsedData = JSON.parse(rawText);
    return res.json({ success: true, data: parsedData });
  } catch (error: any) {
    console.error('Error generating carousel:', error);
    return res.status(500).json({
      error: 'GENERATION_FAILED',
      message: error?.message || 'Failed to generate carousel content.'
    });
  }
});

// Setup Vite middleware for development, or static files for production
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve('dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Carousel Studio server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
