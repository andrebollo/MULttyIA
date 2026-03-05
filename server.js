import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import Paho from 'paho-mqtt'; // Mantive a importação original
import * as fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const MQTT_HOST = process.env.MQTT_HOST || "broker.emqx.io";
const MQTT_PORT = process.env.MQTT_PORT || 8084; 
const MQTT_PATH = process.env.MQTT_PATH || "/mqtt";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- API do Agente -- CORRIGIDO ---

app.post('/api/async', async (req, res) => { // Note a função como 'async'
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

        // Correção Principal: Adicionando messages: [] (Argumento padrão)
        const conversationHistory = [
            { role: "system", content: systemPrompt }
        ];

        conversationHistory.push({ role: "user", content: `Nome: ${username}\nLogs do Sistema:\n${logs}` });

        // Chamada à OpenAI (versão 4+ suporta 'messages' explicitamente)
        const completion = await openai.chat.completions({
            model: "gpt-4o", 
            messages: conversationHistory,
            temperature: 0.3,
            max_tokens: 500 
        });

        const aiResponse = completion.choices[0].message.content;

        // Regex simplificado
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
    console.log(`Servidor rodando em http://localhost:${port}`);
    startMQTT();
});
