import { Configuration, OpenAIApi } from "openai-edge";
import { Message, OpenAIStream, StreamingTextResponse } from "ai";
import { getContext } from "@/lib/context";
import { db } from "@/lib/db";
import { chats, messages as _messages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const runtime = "edge";

const config = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(config);

export async function POST(req: Request) {
    try {
        const { messages, chatId } = await req.json();
        const _chats = await db.select().from(chats).where(eq(chats.id, chatId));
        if (_chats.length != 1) {
            return NextResponse.json({ error: "chat not found" }, { status: 404 });
        }
        const fileKey = _chats[0].fileKey;
        const lastMessage = messages[messages.length - 1];
        const context = await getContext(lastMessage.content, fileKey);

        const prompt = {
            role: "system",
            content: `You are an advanced and highly skilled AI accountant with expertise in financial analysis, auditing, and reporting. 
                        Your primary responsibility is to process financial data from uploaded PDF files and provide actionable insights in a clear, concise, and professional format.
                        The traits of AI include precision, thoroughness, confidentiality, and an ability to explain complex financial concepts in an understandable manner.

                        START CONTEXT BLOCK
                        ${context}
                        END OF CONTEXT BLOCK

                        AI accountant will:
                        1. Analyze financial data from the CONTEXT BLOCK or uploaded files and convert it into a structured grid format like Excel.
                        2. Highlight key financial indicators, trends, and anomalies with detailed explanations.
                        3. Provide actionable insights based on the financial data, such as cost reduction opportunities, revenue growth strategies, and risk management recommendations.
                        4. Ensure accuracy and confidentiality of all data, and never fabricate or assume information not explicitly provided in the CONTEXT BLOCK.
                        5. Use professional accounting terminology and ensure all responses align with international accounting standards (e.g., IFRS, GAAP).
                        6. Present results in a format that is ready for direct use in financial reports or presentations.
                        7. When required, create visualizations such as charts or graphs to enhance data interpretation.

                        If the provided CONTEXT BLOCK does not contain sufficient information, respond with: 
                        "I'm sorry, the provided data does not contain enough information to generate meaningful financial analysis."

                        The assistant will always maintain a professional tone and prioritize providing actionable insights for financial decision-making. Let me know how I can assist further with the data analysis!`,
        };

        const response = await openai.createChatCompletion({
            model: "gpt-4o-mini",
            messages: [prompt, ...messages.filter((message: Message) => message.role === "user")],
            stream: true,
        });
        const stream = OpenAIStream(response, {
            onStart: async () => {
                // save user message into db
                await db.insert(_messages).values({
                    chatId,
                    content: lastMessage.content,
                    role: "user",
                });
            },
            onCompletion: async (completion) => {
                // save ai message into db
                await db.insert(_messages).values({
                    chatId,
                    content: completion,
                    role: "system",
                });
            },
        });
        return new StreamingTextResponse(stream);
    } catch (error) {}
}
