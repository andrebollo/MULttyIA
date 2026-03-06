// --- Imports ---
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import Paho from 'paho-mqtt';
import * as fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const port = process.env.PORT || 3000;
const MQTT_HOST = process.env.MQTT_HOST || "broker.emqx.io";
const MQTT_PORT = parseInt(process.env.MQTT_PORT) || 8084; 
const MQTT_PATH = process.env.MQTT_PATH || "/mqtt";

let mqttClient = null;

function startMQTT() {
    const clientId = "multry_backend_" + Math.random().toString(16).substr(2, 8);
    mqttClient = new Paho.Client(MQTT_HOST, MQTT_PORT, MQTT_PATH, clientId);
    
    mqttClient.onConnectionLost = (responseObject) => {
        console.log("MQTT Connection Lost:", responseObject.errorMessage);
    };

    mqttClient.onMessageArrived = (message) => {
        console.log("MQTT Message:", message.destinationName, message.payloadString);
    };

    mqttClient.connect({
        onSuccess: () => {
            console.log("Backend MQTT Connected");
        },
        onFailure: (e) => {
            console.error("Backend MQTT Failed:", e);
        },
        useSSL: true,
        keepAliveInterval: 30,
        timeout: 10,
        mqttVersion: 4
    });
}

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// --- Lógica MQTT no Backend ---
// ...

// --- API do Agente ---

app.post('/api/ask', async (req, res) => {
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
            finalResponse = "Comando detectado. Enviando para a serial...";
            
            if (mqttClient && mqttClient.isConnected()) {
                const topic = `${room}/serial/input`;
                const mqttMsg = new Paho.Message(commandToSend);
                mqttMsg.destinationName = topic;
                mqttMsg.qos = 1;
                mqttClient.send(mqttMsg);
            }
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
    console.log(`Agente IA rodando em http://localhost:${port}`);
    startMQTT();
});
