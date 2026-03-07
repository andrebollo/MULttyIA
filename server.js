// --- Imports ---
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import * as fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST']
}));

app.use(express.static('.'));

console.log("Arquivos disponíveis:", fs.readdirSync('.'));

app.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'index.html'));
});

const port = process.env.PORT || 3000;

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

console.log("OpenAI configurada:", !!openai);

// --- Lógica MQTT no Backend ---
// ...

// --- API do Agente ---

app.post('/api/ask', async (req, res) => {
    try {
        console.log("Requisição recebida:", req.body);
        const { room, username, logs, question } = req.body;

        if (!logs || !question || !room) {
            console.log("Faltam dados:", { logs: !!logs, question: !!question, room: !!room });
            return res.status(400).json({ error: "Faltam dados (room, username, logs, question)" });
        }

        const systemPrompt = `
            Você é um Engenheiro de Rede experiente.
            Analise os logs abaixo de um equipamento conectado serialmente.
            Se o usuário pedir para investigar um problema (ex: "O IP não pinga"), responda com análise técnica detalhada.
            Se você identificar o problema e houver um comando de correção, envie o comando no formato: [CMD]comando[CMD].
        `;

        const conversationHistory = [
            { role: "system", content: systemPrompt }
        ];

        conversationHistory.push({ role: "user", content: `Nome: ${username}\nLogs:\n${logs}\n\nPergunta: ${question}` });

        if (!openai) {
            return res.status(500).json({ error: "OpenAI não configurada. Defina OPENAI_KEY no .env" });
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: conversationHistory,
        });

        const aiResponse = completion.choices[0].message.content;

        const cmdMatch = aiResponse.match(/\[CMD\]([\s\S]*?)\[\/CMD\]/);
        
        let commandToSend = null;
        let finalResponse = aiResponse;

        if (cmdMatch) {
            commandToSend = cmdMatch[1].trim();
            finalResponse = "Comando detectado. O comando será enviado via MQTT pelo frontend.";
        } else {
            finalResponse = aiResponse;
        }

        res.json({ response: finalResponse, command: commandToSend });

    } catch (error) {
        console.error("Erro na OpenAI:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
});
