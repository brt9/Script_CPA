/*
 * Gerador em lote das planilhas de Consulta Previa (CPA) de municipios de RO.
 *
 * Como usar:
 * 1. Acesse http://localhost:3543/implantacao/monitoramento e mantenha a sessao autenticada.
 * 2. Abra as Ferramentas do Desenvolvedor (F12) e selecione a aba Console.
 * 3. Cole todo este arquivo no Console e pressione Enter.
 * 4. No painel exibido na pagina, clique em "Escolher pasta e iniciar".
 *
 * O script nao altera dados. Ele usa as mesmas rotas de consulta e exportacao da tela.
 */

(async () => {
    'use strict';

    const MUNICIPIOS = [
        'Alvorada d\u00b4Oeste',
        'Campo Novo de Rond\u00f4nia',
        'Castanheiras',
        'Corumbiara',
        'Costa Marques',
        'Cujubim',
        'Governador Jorge Teixeira',
        'Itapu\u00e3 do Oeste',
        'Jaru',
        'Monte Negro',
        'Nova Uni\u00e3o',
        'Novo Horizonte do Oeste',
        'Ouro Preto do Oeste',
        'Pimenta Bueno',
        'Pimenteiras do Oeste',
        'Primavera de Rond\u00f4nia',
        'Rio Crespo',
        'Santa Luzia d\u00b4Oeste',
        'S\u00e3o Felipe d\u00b4Oeste',
        'S\u00e3o Miguel do Guapor\u00e9',
        'Teixeir\u00f3polis',
        'Theobroma',
        'Vale do Anari',
        'Vale do Para\u00edso',
    ];

    const UF = 'RO';
    const PAUSA_ENTRE_MUNICIPIOS_MS = 1200;
    const TEMPO_LIMITE_REQUISICAO_MS = 10 * 60 * 1000;
    const TOTAL_TENTATIVAS = 2;
    const PANEL_ID = 'cpa-ro-download-panel';

    const painelAnterior = document.getElementById(PANEL_ID);
    if (painelAnterior) {
        painelAnterior.remove();
    }

    const normalizarNome = (valor) => String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\u00b4`'\u2018\u2019\u02bc]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .trim()
        .toLowerCase();

    const aguardar = (milissegundos) => new Promise((resolve) => {
        setTimeout(resolve, milissegundos);
    });

    const configElement = document.getElementById('implantacao-monitoramento-config');
    if (!configElement) {
        throw new Error('Abra primeiro a pagina /implantacao/monitoramento e tente novamente.');
    }

    let config;
    try {
        config = JSON.parse(configElement.textContent || '{}');
    } catch (error) {
        throw new Error('Nao foi possivel ler a configuracao da pagina de Monitoramento.');
    }

    const routes = config.routes || {};
    if (!routes.consultaPrevia || !routes.consultaPreviaExport) {
        throw new Error('As rotas de Consulta Previa nao estao disponiveis para o usuario autenticado.');
    }

    const catalogoUf = Array.isArray(config.ufMunicipios)
        ? config.ufMunicipios
        : Object.values(config.ufMunicipios || {});
    const dadosUf = catalogoUf.find((item) => String(item?.acronym || '').trim().toUpperCase() === UF);
    const cidadesUf = (Array.isArray(dadosUf?.cities) ? dadosUf.cities : [])
        .map((cidade) => ({
            id: cidade?.id ?? cidade?.nu_seq_municipio,
            nome: cidade?.name ?? cidade?.municipio_nome,
        }))
        .filter((cidade) => cidade.id && cidade.nome);

    const cidadesPorNome = new Map(
        cidadesUf.map((cidade) => [normalizarNome(cidade.nome), cidade])
    );
    const municipiosResolvidos = MUNICIPIOS.map((nomeInformado) => ({
        nomeInformado,
        cidade: cidadesPorNome.get(normalizarNome(nomeInformado)) || null,
    }));
    const municipiosNaoEncontrados = municipiosResolvidos.filter((item) => !item.cidade);

    const token = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
    const estado = {
        executando: false,
        cancelar: false,
        abortController: null,
    };

    const painel = document.createElement('section');
    painel.id = PANEL_ID;
    painel.setAttribute('role', 'dialog');
    painel.setAttribute('aria-label', 'Gerador de planilhas CPA de Rondonia');
    Object.assign(painel.style, {
        position: 'fixed',
        right: '18px',
        bottom: '18px',
        zIndex: '2147483647',
        width: 'min(560px, calc(100vw - 36px))',
        maxHeight: 'calc(100vh - 36px)',
        overflow: 'auto',
        padding: '18px',
        border: '1px solid #9ca3af',
        borderRadius: '12px',
        background: '#ffffff',
        color: '#111827',
        boxShadow: '0 18px 48px rgba(0, 0, 0, .28)',
        font: '14px/1.45 Arial, sans-serif',
    });

    painel.innerHTML = `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
            <div>
                <strong style="display:block;font-size:17px">Planilhas CPA - Rond\u00f4nia</strong>
                <span data-cpa-resumo style="color:#4b5563"></span>
            </div>
            <button type="button" data-cpa-fechar title="Fechar" style="border:0;background:transparent;font-size:22px;cursor:pointer">\u00d7</button>
        </div>
        <p style="margin:12px 0">
            Cada planilha conter\u00e1 3 meses antes da CPA, o m\u00eas da CPA,
            3 meses depois da CPA e o m\u00eas atual. O processamento \u00e9 sequencial.
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
            <button type="button" data-cpa-pasta style="padding:8px 12px;cursor:pointer">Escolher pasta e iniciar</button>
            <button type="button" data-cpa-downloads style="padding:8px 12px;cursor:pointer">Usar Downloads do navegador</button>
            <button type="button" data-cpa-cancelar disabled style="padding:8px 12px;cursor:pointer">Cancelar</button>
        </div>
        <progress data-cpa-progresso max="${MUNICIPIOS.length}" value="0" style="width:100%;height:16px"></progress>
        <pre data-cpa-log style="margin:12px 0 0;min-height:150px;max-height:310px;overflow:auto;white-space:pre-wrap;background:#111827;color:#f9fafb;padding:12px;border-radius:8px"></pre>
    `;
    document.body.appendChild(painel);

    const resumoElement = painel.querySelector('[data-cpa-resumo]');
    const logElement = painel.querySelector('[data-cpa-log]');
    const progressoElement = painel.querySelector('[data-cpa-progresso]');
    const pastaButton = painel.querySelector('[data-cpa-pasta]');
    const downloadsButton = painel.querySelector('[data-cpa-downloads]');
    const cancelarButton = painel.querySelector('[data-cpa-cancelar]');
    const fecharButton = painel.querySelector('[data-cpa-fechar]');

    resumoElement.textContent = `${MUNICIPIOS.length - municipiosNaoEncontrados.length} de ${MUNICIPIOS.length} municipios localizados no cadastro de ${UF}.`;

    const registrar = (mensagem) => {
        const horario = new Date().toLocaleTimeString('pt-BR');
        logElement.textContent += `[${horario}] ${mensagem}\n`;
        logElement.scrollTop = logElement.scrollHeight;
    };

    if (municipiosNaoEncontrados.length) {
        registrar(`Nao encontrados: ${municipiosNaoEncontrados.map((item) => item.nomeInformado).join(', ')}`);
    } else {
        registrar('Todos os municipios foram localizados. Escolha uma forma de download para iniciar.');
    }

    if (typeof window.showDirectoryPicker !== 'function') {
        pastaButton.disabled = true;
        pastaButton.title = 'Este navegador nao oferece selecao direta de pasta.';
        registrar('Selecao de pasta indisponivel. Use o botao "Downloads do navegador".');
    }

    const obterMensagemErro = (texto, status) => {
        try {
            const json = texto ? JSON.parse(texto) : {};
            return json.error || json.message || `Erro HTTP ${status}`;
        } catch (error) {
            const mensagem = String(texto || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            return mensagem || `Erro HTTP ${status}`;
        }
    };

    const fetchComLimite = async (url, options) => {
        const controller = new AbortController();
        estado.abortController = controller;
        const timeoutId = setTimeout(() => controller.abort(), TEMPO_LIMITE_REQUISICAO_MS);

        try {
            return await fetch(url, {
                ...options,
                signal: controller.signal,
                credentials: 'same-origin',
            });
        } finally {
            clearTimeout(timeoutId);
            if (estado.abortController === controller) {
                estado.abortController = null;
            }
        }
    };

    const headersBase = {
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': token,
        'X-Requested-With': 'XMLHttpRequest',
    };

    const consultarMunicipio = async (payload) => {
        const response = await fetchComLimite(routes.consultaPrevia, {
            method: 'POST',
            headers: {
                ...headersBase,
                Accept: 'application/json',
            },
            body: JSON.stringify(payload),
        });
        const texto = await response.text();
        if (!response.ok) {
            throw new Error(obterMensagemErro(texto, response.status));
        }

        try {
            return texto ? JSON.parse(texto) : {};
        } catch (error) {
            throw new Error('A consulta retornou uma resposta que nao e JSON. Verifique se a sessao continua autenticada.');
        }
    };

    const nomeArquivoDaResposta = (response, nomeFallback) => {
        const disposition = response.headers.get('Content-Disposition') || '';
        const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
        const simples = disposition.match(/filename="?([^";]+)"?/i);
        let nome = nomeFallback;

        if (utf8?.[1]) {
            try {
                nome = decodeURIComponent(utf8[1].trim());
            } catch (error) {
                nome = utf8[1].trim();
            }
        } else if (simples?.[1]) {
            nome = simples[1].trim();
        }

        return nome.replace(/[\\/:*?"<>|]+/g, '_');
    };

    const exportarMunicipio = async (payload, cidade) => {
        const response = await fetchComLimite(routes.consultaPreviaExport, {
            method: 'POST',
            headers: {
                ...headersBase,
                Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const texto = await response.text();
            throw new Error(obterMensagemErro(texto, response.status));
        }

        const contentType = response.headers.get('Content-Type') || '';
        if (/json|text\/html/i.test(contentType)) {
            const texto = await response.text();
            throw new Error(obterMensagemErro(texto, response.status));
        }

        const dataAtual = new Date().toISOString().slice(0, 10).replaceAll('-', '');
        const nomeFallback = `consulta_previa_${normalizarNome(cidade.nome).replaceAll(' ', '_')}_${dataAtual}.xlsx`;

        return {
            blob: await response.blob(),
            nome: nomeArquivoDaResposta(response, nomeFallback),
        };
    };

    const mesDeslocado = (dataCpa, deslocamento) => {
        const match = String(dataCpa || '').match(/^(\d{4})-(\d{2})/);
        if (!match) {
            return null;
        }

        const data = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + deslocamento, 1));
        return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`;
    };

    const salvarArquivo = async (arquivo, diretorio) => {
        if (diretorio) {
            const handle = await diretorio.getFileHandle(arquivo.nome, { create: true });
            const writable = await handle.createWritable();
            await writable.write(arquivo.blob);
            await writable.close();
            return;
        }

        const url = URL.createObjectURL(arquivo.blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = arquivo.nome;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };

    const executarComTentativas = async (acao, descricao) => {
        let ultimoErro;
        for (let tentativa = 1; tentativa <= TOTAL_TENTATIVAS; tentativa += 1) {
            if (estado.cancelar) {
                throw new DOMException('Processamento cancelado.', 'AbortError');
            }

            try {
                return await acao();
            } catch (error) {
                ultimoErro = error;
                if (estado.cancelar || error?.name === 'AbortError' || tentativa === TOTAL_TENTATIVAS) {
                    throw error;
                }

                registrar(`${descricao}: tentativa ${tentativa} falhou; repetindo em 2 segundos.`);
                await aguardar(2000);
            }
        }

        throw ultimoErro;
    };

    const iniciar = async (usarPasta) => {
        if (estado.executando) {
            return;
        }

        let diretorio = null;
        if (usarPasta) {
            try {
                diretorio = await window.showDirectoryPicker({ mode: 'readwrite' });
            } catch (error) {
                if (error?.name !== 'AbortError') {
                    registrar(`Nao foi possivel abrir a pasta: ${error.message}`);
                }
                return;
            }
        }

        estado.executando = true;
        estado.cancelar = false;
        pastaButton.disabled = true;
        downloadsButton.disabled = true;
        cancelarButton.disabled = false;
        fecharButton.disabled = true;
        progressoElement.value = 0;
        logElement.textContent = '';

        const concluidos = [];
        const ignorados = [];
        const erros = [];
        const fila = municipiosResolvidos.filter((item) => item.cidade);

        if (!usarPasta) {
            registrar('Se o navegador solicitar permissao para varios downloads, clique em Permitir.');
        }

        registrar(`Inicio do processamento de ${fila.length} municipio(s).`);

        try {
            for (let indice = 0; indice < fila.length; indice += 1) {
                if (estado.cancelar) {
                    break;
                }

                const { cidade } = fila[indice];
                const identificacao = `${cidade.nome} (${indice + 1}/${fila.length})`;
                progressoElement.value = indice;
                registrar(`${identificacao}: consultando a data da CPA...`);

                try {
                    const payloadBase = {
                        uf: UF,
                        nu_seq_municipio: String(cidade.id),
                    };
                    const consulta = await executarComTentativas(
                        () => consultarMunicipio(payloadBase),
                        identificacao
                    );
                    const dataCpa = consulta?.data_base?.valor || '';
                    const terceiroMesAntes = mesDeslocado(dataCpa, -3);
                    const segundoMesAntes = mesDeslocado(dataCpa, -2);

                    if (!terceiroMesAntes || !segundoMesAntes) {
                        ignorados.push(`${cidade.nome}: data da CPA nao informada`);
                        registrar(`${identificacao}: ignorado porque nao ha data de liberacao da CPA.`);
                        progressoElement.value = indice + 1;
                        continue;
                    }

                    const payloadExportacao = {
                        ...payloadBase,
                        mes_inicial: terceiroMesAntes,
                        mes_final: segundoMesAntes,
                    };
                    registrar(`${identificacao}: CPA ${String(dataCpa).slice(0, 10)}; gerando Excel...`);
                    const arquivo = await executarComTentativas(
                        () => exportarMunicipio(payloadExportacao, cidade),
                        identificacao
                    );
                    await salvarArquivo(arquivo, diretorio);
                    concluidos.push(cidade.nome);
                    registrar(`${identificacao}: concluido - ${arquivo.nome}`);
                } catch (error) {
                    if (estado.cancelar || error?.name === 'AbortError') {
                        registrar(`${identificacao}: processamento interrompido.`);
                        break;
                    }

                    erros.push(`${cidade.nome}: ${error.message}`);
                    registrar(`${identificacao}: ERRO - ${error.message}`);
                }

                progressoElement.value = indice + 1;
                if (indice < fila.length - 1 && !estado.cancelar) {
                    await aguardar(PAUSA_ENTRE_MUNICIPIOS_MS);
                }
            }
        } finally {
            estado.executando = false;
            estado.abortController = null;
            pastaButton.disabled = typeof window.showDirectoryPicker !== 'function';
            downloadsButton.disabled = false;
            cancelarButton.disabled = true;
            fecharButton.disabled = false;
        }

        registrar('--- RESUMO ---');
        registrar(`Concluidos: ${concluidos.length}.`);
        registrar(`Ignorados: ${ignorados.length}.`);
        registrar(`Erros: ${erros.length}.`);
        if (ignorados.length) {
            registrar(`Sem data de CPA: ${ignorados.join(' | ')}`);
        }
        if (erros.length) {
            registrar(`Falhas: ${erros.join(' | ')}`);
        }
        if (estado.cancelar) {
            registrar('Processamento cancelado pelo usuario.');
        } else {
            progressoElement.value = fila.length;
            registrar('Processamento finalizado.');
        }
    };

    pastaButton.addEventListener('click', () => iniciar(true));
    downloadsButton.addEventListener('click', () => iniciar(false));
    cancelarButton.addEventListener('click', () => {
        estado.cancelar = true;
        estado.abortController?.abort();
        cancelarButton.disabled = true;
        registrar('Cancelamento solicitado; aguardando o encerramento da requisicao atual.');
    });
    fecharButton.addEventListener('click', () => {
        if (!estado.executando) {
            painel.remove();
        }
    });
})();
