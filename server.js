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
Você está integrado a um terminal serial de um roteador Cisco.

REGRAS IMPORTANTES:
1. Quando o usuário pedir informações (como IP, configuração, status), você DEVE primeiro enviar um comando para obter essa informação.
2. Use sempre o formato [CMD]comando[CMD] para enviar comandos.
3. Após enviar o comando, NÃO dé a resposta final imediatamente. Em vez disso, diga algo como "Executando o comando... aguarde o resultado no terminal."
4. O usuário executará o comando e você receberá os logs automaticamente. Só então dará a resposta definitiva baseada nos logs.

Exemplo de fluxo correto:
- Usuário: "Qual o IP da VLAN1?"
- Você: "Vou verificar para você. Execute o comando: [CMD]show ip interface brief[CMD]"

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

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        const result = await model.generateContent(prompt);
        const aiResponse = result.response.text();

        const cmdMatch = aiResponse.match(/\[CMD\]([\s\S]*?)\[\/CMD\]/);
        
        let commandToSend = null;
        let finalResponse = aiResponse;

        if (cmdMatch) {
            commandToSend = cmdMatch[1].trim();
            console.log("COMANDO DETECTADO:", commandToSend);
            finalResponse = "Comando detectado. O comando será enviado via MQTT pelo frontend.";
        } else {
            console.log("Nenhum comando detectado na resposta");
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
