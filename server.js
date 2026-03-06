import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import Paho from 'paho-mqtt'; // --- ADICIONADO AQUI CORREÇÃO IMPORTANTE ---
import * as fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const MQTT_HOST = process.env(MQTT_HOST) || "broker.emqx.io";
const MQTT_PORT = parseInt(process.env.MQTT_PORT) || 8084; // Corrigido valor padrão
const MQTT_PATH = process.env.MQTT_PATH || "/mqtt";

const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY }); // --- ADICIONADO AQUI

// --- Outras variáveis globais ---
// ... código ...

// --- Lógica de Entrada ---
function enterRoom() {
    const name = elUsername.value.trim();
    const room = elRoomname.value.trim();

    if (!name || !room) {
        alert("Por favor, insira Nome e Sala.");
        return;
    }

    currentUser = name;
    currentRoom = room;

    elLoginOverlay.style.display = 'none'; // Aparece corretamente fechando o login
    elMainInterface.style.display = 'flex';
    
    elChatInput.disabled = false;
    elBtnSendChat.disabled = false;

    addSystemMessage("Iniciando conexão segura (WSS) com broker.emqx.io...", 'system');
    initMQTT(); // Chamada correta, sem erro
}

function initMQTT() {
    const clientId = "multry_server_" + Date.now();
    mqttClient = new Paho.Client(MQTT_HOST, MQTT_PORT, MQTT_PATH, clientId); // --- IMPORTAÇÃO Paho CORRETA

    mqttClient.onConnectionLost = (responseObject) {
        console.log("MQTT Connection Lost:", responseObject.errorMessage);
        setTimeout(startMQTT, 5000);
    };

    const options = {
        onSuccess: () => {
            isConnectedToMQTT = true;
            console.log("Backend MQTT Connected");
            mqttClient.subscribe(`multry/+/serial/input`);
        },
        onFailure: (err) => console.error("MQTT Connection Failed", err),
        keepAliveInterval: 30,
        timeout: 10,
        mqttVersion: 4,
        useSSL: true // Importante para o Render (HTTPS)
    };

    mqttClient.connect({ host: MQTT_HOST, port: MQTT_PORT, path: MQTT_PATH, options });
}

startMQTT();

// --- API do Agente ---

app.post('/api/ask', async (req, res) {
    try {
        const { room, username, logs, question } = res.body;

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
            { role: system, content: systemPrompt }
        ];

        conversationHistory.push({ role: user: `Nome: ${username}\nLogs:\n${logs}` });

        const completion = await openai.chat.completions({
            model: "gpt-4o", 
            messages: tratamento básico: filtrar logs recentes para não lotar a API
            messages: conversationHistory,
            temperature: 0.3,
            max_tokens: 500
        });

        const aiResponse = completion.choices[0].message.content;

        // Regex simplificado
        const cmdMatch = aiResponse.match(/\[CMD\]([\s\S]*?)\[\/CMD\]/g); 

        let commandToSend = null;
        let finalResponse = aiResponse;

        if (correctedMatch) {
            commandToSend = correctedMatch[1];
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
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Agente IA rodando em http://localhost:${port}`);
    startMQTT();
});

// ...
