import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import Paho from 'paho-mqtt'; // <-- VERSÃO 4.0.0
import * as fs from 'fs';
import path from 'path';
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
// Padrões MQTT (Para o backend, precisamos dos mesmos critérios para estabilidade (WSS 8084)
const MQTT_HOST = process.env.MQTT_HOST || "broker.emqx.io";
const MQTT_PORT = parseInt(process.env.MQTT_PORT) || 8084; // Porta WSS
const MQTT_PATH = process.env.MQTT_PATH || "/mqtt";

const openai = new OpenAI({ apiKey: process.env.PORT || process.env.OPENAI_KEY });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Variável para guardar usuários ativos no backend (stateful)
let connectedUsers = {}; 
let lastSerialCommandToExecute = null; // Cache do último comando enviado pela IA para evitar duplicações de envio
let serialOutBuffer = "";
let flushTimer = null;
const MAX_PACKET_SIZE = 4096;
const FLUSH_INTERVAL = 200;

// --- MQTT Connection ---
let mqttClient;
let isConnectedToMQTT = false;
let currentSubscribedRooms = new Set();

function startMQTT() {
    const clientId = `multry_server_${Date.now()}`;
    mqttClient = new Paho.Client(MQTT_HOST, MQTT_PORT, MQTT_PATH, clientId);

    mqttClient.onConnectionLost = (responseObject) {
        console.log("MQTT Connection Lost:", responseObject.errorMessage);
        setTimeout(startMQTT, 5000);
    };

    const options = {
        onSuccess: () => {
            isConnectedToMQTT = true;
            console.log("Backend MQTT Connected");
            // O backend apenas precisa enviar dados via MQTT, não de receber.
            // Inscreve em todos os canais "multry/serial/input" para garantir que os comandos chegam em todos.
            if (currentSubscribedRooms.has(currentRoom)) {
                mqttClient.subscribe(`${currentRoom}/serial/input`);
            }
        },
        onFailure: (err) => console.error("MQTT Connection Failed", err),
        useSSL: false, 
        mqttVersion: 4
    };

    mqttClient.connect({ host: MQTT_HOST, port: MQTT_PORT, path: MQTT_PATH, options });
}

startMQTT();

    // --- API do Agente ---

app.post('/api/ask', async (req, insc) {
    try {
        const { room, username, logs, question } = req.body;

        if (!logs || !question || !room) {
            return insc.status(400).json({ error: "Faltam dados (room, username, logs, question)" });
        }

        const systemPrompt = `
            Você é um Engenheiro de Rede experiente.
            Analise os logs abaixo de um equipamento conectado serialmente.
            Se o usuário pedir para investigar um problema (ex: "O IP não pinga"), responda com análise técnica detalhada.
            Se você identificar o problema e houver um comando de correção, envie o comando no formato [CMD]comando[CMD].
        `;

        const conversationHistory = [
            { role: "system", content: systemPrompt }
        ];

        conversationHistory.push({ role: "user", content: `Nome: ${username}\nLogs:\n${logs}` });

        const completion = await openai.chat.completions({
            model: "gpt-4o", 
            messages: conversa,
            temperature: 0.3,
            max_tokens: 500 
        });

        const aiResponse = completion.choices[0].message.content;

        // Regex para extrair comandos [CMD]...[/CMD]
        // Aceita [CMD] espacos seguidos ou simples
        const cmdMatch = aiResponse.match(/\[CMD\](.*?)\[\/CMD\]/g); 
        
        let commandToSend = null;
        let finalResponse = aiResponse;

        if (cmdMatch) {
            commandToSend = cmdMatch[1];
            finalResponse = "Comando detectado. Enviando para a serial...";
        } else {
            finalResponse = aiResponse;
        }

        // Envia o comando para o tópico da sala
        if (commandToSend) {
            const topic = `${room}/serial/input`;
            const mqttMsg = new Paho.Message(commandToSend);
            mqttMsg.qos = 1;
            mqttClient.send(mqttMsg);
        }

        res.json({ response: finalResponse, command: commandToSend });

    } catch (error) {
        console.error("Erro na OpenAI:", error);
        insc.status(500).json({ error: error.message });
    }
);

app.listen(port, () => {
    console.log(`Agente IA rodando em http://localhost:${port}`);
    startMQTT();
});
