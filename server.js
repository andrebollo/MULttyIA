// --- Imports ---
import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
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

// Google Gemini - use GEMINI_API_KEY
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

console.log("Gemini configurado:", !!genAI);

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
Você é um Engenheiro de Rede experiente chamado AndreIA.
Analise os logs abaixo de um equipamento conectado serialmente.
Se o usuário pedir para investigar um problema (ex: "O IP não pinga"), responda com análise técnica detalhada.
Se você identificar o problema e houver um comando de correção, envie o comando no formato: [CMD]comando[CMD].
Responda sempre em português brasileiro, de forma clara e útil.
`;

        const prompt = `${systemPrompt}

Nome do usuário: ${username}

Logs do terminal:
${logs}

Pergunta do usuário: ${question}`;

        if (!genAI) {
            return res.status(500).json({ error: "AndreIA não configurada. Defina GEMINI_API_KEY no .env" });
        }

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const result = await model.generateContent(prompt);
        const aiResponse = result.response.text();

        const cmdMatch = aiResponse.match(/\[CMD\]([\s\S]*?)\[\/CMD\]/);
        
        let commandToSend = null;
        let finalResponse = aiResponse;

        if (cmdMatch) {
            commandToSend = cmdMatch[1].trim();
            finalResponse = "Comando detectado. O comando será enviado via MQTT pelo frontend.";
        }

        res.json({ response: finalResponse, command: commandToSend });

    } catch (error) {
        console.error("Erro na Gemini:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
});
