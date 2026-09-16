/*
 * Relatório Unificado do Paraná — lote 1 de 3.
 *
 * Uso:
 * 1. Abra http://localhost:3543/implantacao/monitoramento e acesse a aba Relatório Unificado.
 * 2. Preencha Mês inicial e Mês final (intervalo máximo de 12 meses).
 * 3. Abra o Console do navegador, cole todo este arquivo e pressione Enter.
 * 4. No painel exibido, escolha onde salvar ou use a pasta Downloads.
 *
 * Execute somente um lote por vez e mantenha a página aberta até a conclusão.
 */

(function executarRelatorioUnificadoPr(LOTE, MUNICIPIOS) {
    'use strict';

    const TOTAL_LOTES = 3;
    const UF = 'PR';
    const CONFIG_ID = 'implantacao-monitoramento-config';
    const PANEL_ID = `navi-relatorio-unificado-pr-lote-${LOTE}`;
    const LOCK_KEY = '__naviRelatorioUnificadoPrEmExecucao';
    const DEFAULT_FILENAME = `relatorio_unificado_monitoramento_pr_lote_${LOTE}_de_${TOTAL_LOTES}.xlsx`;
    const existingPanel = document.getElementById(PANEL_ID);

    if (existingPanel) {
        existingPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        console.warn(`O painel do lote ${LOTE} já está aberto.`);
        return;
    }

    if (!location.pathname.includes('/implantacao/monitoramento')) {
        alert('Abra a página /implantacao/monitoramento antes de executar este script.');
        return;
    }

    const normalize = (value) => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase('pt-BR');

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.style.cssText = [
        'position:fixed',
        'right:20px',
        'bottom:20px',
        'z-index:2147483647',
        'width:min(480px,calc(100vw - 40px))',
        'max-height:calc(100vh - 40px)',
        'overflow:auto',
        'padding:16px',
        'border:1px solid #bfdbfe',
        'border-radius:12px',
        'background:#ffffff',
        'box-shadow:0 18px 50px rgba(15,23,42,.28)',
        'color:#0f172a',
        'font:14px/1.45 Arial,sans-serif'
    ].join(';');
    panel.innerHTML = `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
            <div>
                <strong style="display:block;font-size:16px">Relatório Unificado PR — lote ${LOTE}/${TOTAL_LOTES}</strong>
                <span style="color:#475569">${MUNICIPIOS.length} municípios; gera um único arquivo XLSX.</span>
            </div>
            <button type="button" data-close title="Fechar" style="border:0;background:transparent;font-size:22px;line-height:1;cursor:pointer;color:#64748b">×</button>
        </div>
        <p style="margin:12px 0;color:#334155">
            O período será lido dos campos <strong>Mês inicial</strong> e <strong>Mês final</strong>
            da aba Relatório Unificado. Não feche esta página durante o processamento.
        </p>
        <div style="height:10px;overflow:hidden;border-radius:999px;background:#e2e8f0">
            <div data-progress style="height:100%;width:0;background:#2563eb;transition:width .2s ease"></div>
        </div>
        <div data-status style="margin:8px 0 12px;font-weight:600">Pronto para iniciar.</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
            <button type="button" data-start-picker style="padding:8px 11px;border:0;border-radius:7px;background:#2563eb;color:#fff;cursor:pointer">
                Escolher arquivo e iniciar
            </button>
            <button type="button" data-start-download style="padding:8px 11px;border:1px solid #94a3b8;border-radius:7px;background:#fff;color:#0f172a;cursor:pointer">
                Salvar em Downloads
            </button>
            <button type="button" data-cancel disabled style="padding:8px 11px;border:1px solid #fca5a5;border-radius:7px;background:#fff;color:#b91c1c;cursor:pointer">
                Cancelar
            </button>
        </div>
        <pre data-log style="box-sizing:border-box;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;margin:12px 0 0;padding:10px;border-radius:7px;background:#0f172a;color:#e2e8f0;font:12px/1.45 Consolas,monospace"></pre>
    `;
    document.body.appendChild(panel);

    const closeButton = panel.querySelector('[data-close]');
    const pickerButton = panel.querySelector('[data-start-picker]');
    const downloadButton = panel.querySelector('[data-start-download]');
    const cancelButton = panel.querySelector('[data-cancel]');
    const progressBar = panel.querySelector('[data-progress]');
    const statusElement = panel.querySelector('[data-status]');
    const logElement = panel.querySelector('[data-log]');
    const logLines = [];

    let running = false;
    let cancelled = false;
    let activeController = null;
    let currentLock = null;
    let wakeLock = null;

    function log(message, level = 'info') {
        const time = new Date().toLocaleTimeString('pt-BR');
        const line = `[${time}] ${String(message)}`;
        logLines.push(line);
        if (logLines.length > 180) {
            logLines.splice(0, logLines.length - 180);
        }
        logElement.textContent = logLines.join('\n');
        logElement.scrollTop = logElement.scrollHeight;

        const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
        console[consoleMethod](`[Relatório unificado PR ${LOTE}/${TOTAL_LOTES}] ${message}`);
    }

    function setStatus(message, percent) {
        const safePercent = Number.isFinite(Number(percent))
            ? Math.max(0, Math.min(100, Number(percent)))
            : 0;
        progressBar.style.width = `${safePercent}%`;
        statusElement.textContent = `${Math.floor(safePercent)}% — ${message}`;
    }

    function setRunning(value) {
        running = value;
        pickerButton.disabled = value;
        downloadButton.disabled = value;
        cancelButton.disabled = !value;
        closeButton.disabled = value;
        pickerButton.style.opacity = value ? '.6' : '1';
        downloadButton.style.opacity = value ? '.6' : '1';
        cancelButton.style.opacity = value ? '1' : '.6';
    }

    function beforeUnload(event) {
        if (!running) {
            return;
        }
        event.preventDefault();
        event.returnValue = '';
    }

    function getContext() {
        const configElement = document.getElementById(CONFIG_ID);
        if (!configElement) {
            throw new Error('A configuração da página não foi encontrada. Atualize a página e tente novamente.');
        }

        let config;
        try {
            config = JSON.parse(configElement.textContent || '{}');
        } catch (error) {
            throw new Error('A configuração do monitoramento está inválida.');
        }

        const routes = config.routes || {};
        const requiredRoutes = [
            'relatorioUnificadoStart',
            'relatorioUnificadoProcess',
            'relatorioUnificadoExport'
        ];
        const missingRoutes = requiredRoutes.filter((key) => !routes[key]);
        if (missingRoutes.length) {
            throw new Error('Seu usuário não possui as rotas necessárias para gerar o relatório unificado.');
        }

        const ufCatalog = Array.isArray(config.ufMunicipios)
            ? config.ufMunicipios.find((item) => String(item?.acronym || '').toUpperCase() === UF)
            : config.ufMunicipios?.[UF]
                || Object.values(config.ufMunicipios || {})
                    .find((item) => String(item?.acronym || '').toUpperCase() === UF);
        const cities = Array.isArray(ufCatalog?.cities) ? ufCatalog.cities : [];
        if (!cities.length) {
            throw new Error('O catálogo de municípios do Paraná não foi carregado pela página.');
        }

        const citiesByName = new Map();
        for (const city of cities) {
            const key = normalize(city?.name);
            if (key && !citiesByName.has(key)) {
                citiesByName.set(key, city);
            }
        }

        const unresolved = MUNICIPIOS.filter((name) => !citiesByName.has(normalize(name)));
        if (unresolved.length) {
            throw new Error(`Municípios não encontrados no catálogo: ${unresolved.join(', ')}.`);
        }

        const resolved = MUNICIPIOS.map((name) => citiesByName.get(normalize(name)));
        const ids = resolved.map((city) => String(city.id));
        if (new Set(ids).size !== MUNICIPIOS.length) {
            throw new Error('O lote contém municípios duplicados após a resolução dos códigos.');
        }

        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
        if (!csrfToken) {
            throw new Error('O token de segurança da sessão não foi encontrado. Atualize a página.');
        }

        const mesInicial = String(document.getElementById('monitoramento-unificado-mes-inicial')?.value || '').trim();
        const mesFinal = String(document.getElementById('monitoramento-unificado-mes-final')?.value || '').trim();
        const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

        if (!monthPattern.test(mesInicial) || !monthPattern.test(mesFinal)) {
            throw new Error('Preencha Mês inicial e Mês final na aba Relatório Unificado antes de iniciar.');
        }

        const monthNumber = (value) => {
            const [year, month] = value.split('-').map(Number);
            return (year * 12) + month;
        };
        const interval = monthNumber(mesFinal) - monthNumber(mesInicial);
        if (interval < 0) {
            throw new Error('O mês inicial não pode ser maior que o mês final.');
        }
        if (interval > 11) {
            throw new Error('O intervalo do relatório deve ter no máximo 12 meses.');
        }

        return {
            routes,
            csrfToken,
            mesInicial,
            mesFinal,
            ids,
            filename: `relatorio_unificado_monitoramento_pr_${mesInicial}_a_${mesFinal}_lote_${LOTE}_de_${TOTAL_LOTES}.xlsx`
        };
    }

    function errorFromText(response, text) {
        let parsed = null;
        try {
            parsed = text ? JSON.parse(text) : null;
        } catch (error) {
            parsed = null;
        }

        let detail = parsed?.error || parsed?.message || '';
        if (!detail && parsed?.errors && typeof parsed.errors === 'object') {
            detail = Object.values(parsed.errors).flat().filter(Boolean).join(' ');
        }

        if (!detail && /<html[\s>]/i.test(text || '')) {
            const html = new DOMParser().parseFromString(text, 'text/html');
            detail = [
                html.querySelector('h1')?.textContent,
                html.querySelector('p')?.textContent
            ].filter(Boolean).map((value) => value.trim()).join(' — ');
        }

        if (!detail) {
            detail = String(text || '').replace(/\s+/g, ' ').trim() || 'Falha na requisição.';
        }

        const httpError = new Error(`Erro HTTP ${response.status}: ${detail}`);
        httpError.status = response.status;
        return httpError;
    }

    async function postJson(url, payload, context) {
        activeController = new AbortController();
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': context.csrfToken,
                    'X-Requested-With': 'XMLHttpRequest',
                    Accept: 'application/json'
                },
                body: JSON.stringify(payload),
                credentials: 'same-origin',
                signal: activeController.signal
            });
            const text = await response.text();

            if (!response.ok) {
                throw errorFromText(response, text);
            }

            try {
                return text ? JSON.parse(text) : {};
            } catch (error) {
                throw new Error('O servidor respondeu em formato inesperado.');
            }
        } finally {
            activeController = null;
        }
    }

    async function postFile(url, payload, context) {
        activeController = new AbortController();
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': context.csrfToken,
                    'X-Requested-With': 'XMLHttpRequest',
                    Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/json'
                },
                body: JSON.stringify(payload),
                credentials: 'same-origin',
                signal: activeController.signal
            });

            if (!response.ok) {
                throw errorFromText(response, await response.text());
            }

            const contentType = String(response.headers.get('Content-Type') || '').toLowerCase();
            if (contentType.includes('application/json') || contentType.includes('text/html')) {
                throw errorFromText(response, await response.text());
            }

            return response.blob();
        } finally {
            activeController = null;
        }
    }

    function retryable(error) {
        return error?.name !== 'AbortError'
            && (!Number.isFinite(Number(error?.status))
                || Number(error.status) === 429
                || Number(error.status) >= 500);
    }

    async function wait(milliseconds) {
        const finish = Date.now() + milliseconds;
        while (Date.now() < finish) {
            if (cancelled) {
                throw new DOMException('Processamento cancelado.', 'AbortError');
            }
            await new Promise((resolve) => setTimeout(resolve, Math.min(300, finish - Date.now())));
        }
    }

    async function withRetry(operation, description, attempts = 3) {
        let lastError;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                if (cancelled || !retryable(error) || attempt === attempts) {
                    throw error;
                }
                const delay = attempt * 15000;
                log(`${description} falhou (${error.message}). Nova tentativa em ${delay / 1000}s.`, 'warn');
                await wait(delay);
            }
        }
        throw lastError;
    }

    async function processJob(jobId, context) {
        let lastLoggedPercent = null;

        for (let step = 1; step <= 50000; step++) {
            if (cancelled) {
                throw new DOMException('Processamento cancelado.', 'AbortError');
            }

            const status = await withRetry(
                () => postJson(context.routes.relatorioUnificadoProcess, { job_id: jobId }, context),
                'A etapa de processamento'
            );
            const progress = status.progress || {};
            const percent = Number(progress.percent || 0);
            const message = progress.message || 'Processando relatório unificado...';
            const done = Number(progress.done || 0);
            const total = Number(progress.total || 0);

            setStatus(`${message}${total ? ` (${done}/${total})` : ''}`, percent);
            if (percent !== lastLoggedPercent) {
                log(`${Math.floor(percent)}% — ${message}`);
                lastLoggedPercent = percent;
            }

            if (status.status === 'completed') {
                return status;
            }
            if (status.status && status.status !== 'processing') {
                throw new Error(`O servidor retornou o estado inesperado "${status.status}".`);
            }

            await wait(350);
        }

        throw new Error('O relatório excedeu o limite de 50.000 etapas de processamento.');
    }

    async function saveBlob(blob, filename, fileHandle) {
        if (fileHandle) {
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            return fileHandle.name || filename;
        }

        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = filename || DEFAULT_FILENAME;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
        return filename || DEFAULT_FILENAME;
    }

    async function requestWakeLock() {
        if (!navigator.wakeLock?.request) {
            return;
        }
        try {
            wakeLock = await navigator.wakeLock.request('screen');
        } catch (error) {
            log('Não foi possível manter a tela ativa automaticamente; mantenha esta aba aberta.', 'warn');
        }
    }

    async function run(useFilePicker) {
        if (running) {
            return;
        }

        let context;
        try {
            context = getContext();
        } catch (error) {
            setStatus('Verifique os dados informados.', 0);
            log(error.message, 'error');
            return;
        }

        const otherExecution = window[LOCK_KEY];
        if (otherExecution?.running) {
            log(`O lote ${otherExecution.lote} já está em execução. Aguarde a conclusão antes de iniciar outro lote.`, 'error');
            return;
        }

        cancelled = false;
        setRunning(true);
        currentLock = { running: true, lote: LOTE, panelId: PANEL_ID };
        window[LOCK_KEY] = currentLock;
        window.addEventListener('beforeunload', beforeUnload);

        let fileHandle = null;
        try {
            if (useFilePicker && typeof window.showSaveFilePicker === 'function') {
                fileHandle = await window.showSaveFilePicker({
                    suggestedName: context.filename,
                    types: [{
                        description: 'Planilha do Excel',
                        accept: {
                            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
                        }
                    }]
                });
            } else if (useFilePicker) {
                log('O navegador não oferece escolha direta do arquivo; será usada a pasta Downloads.', 'warn');
            }

            await requestWakeLock();
            log(`Iniciando lote ${LOTE}/${TOTAL_LOTES}: ${MUNICIPIOS.length} municípios, período ${context.mesInicial} a ${context.mesFinal}.`);
            setStatus('Criando processamento no servidor...', 0);

            const started = await postJson(context.routes.relatorioUnificadoStart, {
                uf: UF,
                municipios: context.ids,
                mes_inicial: context.mesInicial,
                mes_final: context.mesFinal
            }, context);
            const jobId = String(started.job_id || '');
            if (!/^[a-f0-9]{32}$/i.test(jobId)) {
                throw new Error('O servidor não retornou um identificador válido para o processamento.');
            }

            log(`Processamento criado: ${jobId}.`);
            const completed = await processJob(jobId, context);
            const totalMunicipios = Number(completed.result?.resumo?.total_municipios);
            if (totalMunicipios !== MUNICIPIOS.length) {
                throw new Error(`O servidor concluiu ${totalMunicipios || 0} de ${MUNICIPIOS.length} municípios; o arquivo não será exportado.`);
            }

            setStatus('Gerando e salvando a planilha...', 100);
            log('Processamento concluído. Gerando o arquivo XLSX.');
            const blob = await withRetry(
                () => postFile(context.routes.relatorioUnificadoExport, { job_id: jobId }, context),
                'A exportação',
                2
            );
            const savedName = await saveBlob(blob, context.filename, fileHandle);

            setStatus('Arquivo gerado com sucesso.', 100);
            log(`CONCLUÍDO — arquivo salvo como ${savedName}.`);
        } catch (error) {
            if (error?.name === 'AbortError') {
                setStatus('Processamento cancelado.', 0);
                log('Processamento cancelado. Nenhum arquivo foi gerado.', 'warn');
            } else {
                setStatus('Falha no processamento.', 0);
                log(`ERRO — ${error.message}`, 'error');
            }
        } finally {
            setRunning(false);
            window.removeEventListener('beforeunload', beforeUnload);
            if (window[LOCK_KEY] === currentLock) {
                delete window[LOCK_KEY];
            }
            currentLock = null;
            if (wakeLock) {
                try {
                    await wakeLock.release();
                } catch (error) {
                    // O bloqueio de tela pode ter sido liberado pelo próprio navegador.
                }
                wakeLock = null;
            }
        }
    }

    closeButton.addEventListener('click', () => {
        if (!running) {
            panel.remove();
        }
    });
    pickerButton.addEventListener('click', () => run(true));
    downloadButton.addEventListener('click', () => run(false));
    cancelButton.addEventListener('click', () => {
        if (!running) {
            return;
        }
        cancelled = true;
        cancelButton.disabled = true;
        setStatus('Cancelando após a requisição atual...', Number.parseFloat(progressBar.style.width) || 0);
        activeController?.abort();
    });

    log(`Lote ${LOTE}/${TOTAL_LOTES} carregado com ${MUNICIPIOS.length} municípios.`);
})(1, [
    "Almirante Tamandaré",
    "Araucária",
    "Assaí",
    "Astorga",
    "Balsa Nova",
    "Bandeirantes",
    "Barbosa Ferraz",
    "Bituruna",
    "Bom Jesus Do Sul",
    "Bom Sucesso Do Sul",
    "Cambará",
    "Cambé",
    "Campo Largo",
    "Campo Mourão",
    "Capanema",
    "Capitão Leônidas Marques",
    "Carlópolis",
    "Castro",
    "Céu Azul",
    "Chopinzinho",
    "Cianorte",
    "Colombo",
    "Corbélia",
    "Cruz Machado",
    "Cruzeiro Do Oeste",
    "Curiúva",
    "Dois Vizinhos",
    "Engenheiro Beltrão",
    "Faxinal",
    "Fazenda Rio Grande",
    "Francisco Beltrão",
    "General Carneiro",
    "Goioerê",
    "Guaíra",
    "Guaraci"
]);

