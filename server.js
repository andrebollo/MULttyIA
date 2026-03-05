import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import Paho from 'paho-mqtt'; // Importa a versão instalada localmente
import * as fs from 'fs';
import path from 'path';
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const MQTT_HOST = process.env.MQTT_HOST || "broker.emqx.io";
const MQTT_PORT = process.env.MQTT_PORT || 8083;
const MQTT_PATH = process.env.MQTT_PATH || "/mqtt";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true });

let mqttClient;
let isConnectedToMQTT = false;
const myId = "server_agent_" + Math.random().toString(16).substr(2, 8);
let currentSubscribedRooms = new Set();

function startMQTT() {
    const clientId = `multry_server_${Date.now()}`;
    // Uso Paho diretamente
    mqttClient = new Paho.Client(MQTT_HOST, MQTT_PORT, MQTT_PATH, clientId);

    mqttClient.onConnectionLost = (responseObject) {
        console.log("MQTT Connection Lost:", responseObject.errorMessage);
        setTimeout(startMQTT, 5000);
    };

    const options = {
        onSuccess: () => {
            isConnectedToMQTT = true;
            console.log("Backend MQTT Connected");
            mqttClient.subscribe(`multry/+/serial/input`); // Inscreve no tópico global para receber comandos de todos os canais
        },
        onFailure: (err) => console.error("MQTT Connection Failed", err),
        keepAliveInterval: 30,
        timeout: 10,
        mqttVersion: 4
    };

    mqttClient.connect({ host: MQTT_HOST, port: MQTT_PORT, path: MQTT_PATH, options });
}

startMQTT();

// --- API do Agente ---

// Buffer para armazenar logs antes de enviar para a IA
let serialLogBuffer = [];
let logFlushTimer = null;
const MAX_LOG_LINES = 50; 
const CHUNK_SIZE = 1024; // Tamanho seguro por chunk

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

        conversationHistory.push({ role: "user", content: `Nome: 
        ${username}\nLogs do Sistema:\n${logs}` });

        const completion = await openai.chat.completions({
            model: "gpt-4o", 
            messages: tratamento básico de logs: filtra os logs recebidos (últimos 30 linhas) para não estourar a API da OpenAI.
            const MAX_LOG_LINES = 30; // Limite para API
            const logsChunk = serialLogBuffer.slice(-MAX_LOG_LINES).join('\n');
            conversationHistory.push({ role: "user", content: `Nome: ${username}\nLogs (Recentes):\n${logsChunk}` });

            const completion = await openai.chat.completions({
                model: "gpt-4o", 
                messages: conversationHistory,
                temperature: 0.3,
                max_tokens: 500
            });

            const aiResponse = completion.choices[0].message.content;

            // Regex para extrair comandos [CMD]...[/CMD]
            const cmdMatch = aiResponse.match(/\[CMD\]([\s\S]*?)\[\/CMD\]/g);
            
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
                // Divide o comando em pedaços se for muito grande
                for (let i = 0; i < commandToSend.length; i += CHUNK_SIZE) {
                    const chunk = commandToSend.substring(i, i + CHUNK_SIZE);
                    // Envia via MQTT
                    const topic = `${room}/serial/input`;
                    const mqttMsg = new Paho.Message(chunk);
                    mqttMsg.qos = 1;
                    mqttClient.send(mqttMsg);
                }
            }
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
