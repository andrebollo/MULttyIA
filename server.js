import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
// Importa a versão local do arquivo baixado
import * as Paho from './mqttws31-min.js'; 
import * as fs from 'fs';
import path from 'path';
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
// Usa strings literais para evitar erros no backend
const MQTT_HOST = process.env.MQTT_HOST || "broker.emqx.io";
const MQTT_PORT = parseInt(process.env.MQTT_PORT) || 8084;
const MQTT_PATH = process.env.MQTT_PATH || "/mqtt";

const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let mqttClient;
let isConnectedToMQTT = false;
const myId = "server_agent_" + Math.random().toString(16).substr(2, 8);

function startMQTT() {
    // Usa MQTT_HOST literal para evitar o erro "Unexpected token"
    mqttClient = new Paho.Client("broker.emqx.io", 8084, "/mqtt");
    
    // Opções de conexão
    const options = {
        onSuccess: () => {
            isConnectedToMQTT = true;
            console.log("Backend MQTT Connected");
            mqttClient.subscribe(`multry/+/serial/input`);
        },
        onFailure: (err) => console.error("MQTT Connection Failed", err),
        mqttVersion: 4,
        keepAliveInterval: 30,
        useSSL: false, // Backend não precisa de SSL (ou use true se forçar)
        timeout: 10
    };

    mqttClient.connect(options);
}

// --- API do Agente ---
app.post('/api/ask', async (req, res) {
    try {
        const { room, username, logs, question } = req.body;
        
        if (!logs || !question || !room) {
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
        
        // Filtra os últimos logs para não estourar a API
        // Corta os logs para o chat
        const lastLogs = serialLogBuffer.split('\n').slice(-30).join('\n');

        conversationHistory.push({ role: "user", content: `Nome: ${username}\nLogs Recebidos (Streaming):\n${lastLogs}` });

        const completion = await openai.chat.completions({
            model: "gpt-4o", 
            messages: conversationHistory,
            temperature: 0.3,
            max_tokens: 500 
        });

        const aiResponse = completion.choices[0].message.content;

        // Regex simplificado para evitar o erro de "Unexpected token"
        // Procura por [CMD]...[/CMD]
        const cmdMatch = aiResponse.match(/\[CMD\]([\s\S]*?)\[\/CMD\]/g); 
        
        let commandToSend = null;
        let finalResponse = aiResponse;

        if (cmdMatch) {
            commandToSend = cmdMatch[1];
            finalResponse = "Comando detectado. Enviando para a serial...";
        } else {
            finalResponse = aiResponse;
        }

        if (commandToSend) {
            // Envia o comando para o tópico da sala
            const topic = `${room}/serial/input`;
            const mqttMsg = new Paho.Message(commandToSend);
            mqttMsg.qos = 1;
            mqttClient.send(mqttMsg);
        }

        res.json({ response: finalResponse, command: commandToSend });

    } catch (error) {
        console.error("Erro na OpenAI:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Agente IA rodando em http://localhost:${port}`);
    startMQTT();
});
