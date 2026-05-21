import { getRandomValues, randomUUID } from 'crypto'
import { BOT_RENDERING_CONFIG_METADATA, DONATE_URL, LEXER_REGEX } from '../Defaults'
import { LANGUAGE_KEYWORDS } from '../WABinary/constants'
import { CodeHighlightType, RichSubMessageType } from '../Types/RichType'
import { proto } from '../../WAProto/index.js'
import { unixTimestampSeconds } from './generics'

export const tokenizeCode = (code: string, language = 'javascript') => {
	const keywords = LANGUAGE_KEYWORDS[language] || new Set<string>([])
	const blocks: { highlightType: CodeHighlightType; codeContent: string }[] = []
	LEXER_REGEX.lastIndex = 0
	let match: RegExpExecArray | null
	while ((match = LEXER_REGEX.exec(code)) !== null) {
		if (match[1]) {
			blocks.push({ highlightType: CodeHighlightType.COMMENT, codeContent: match[1] })
		} else if (match[2]) {
			blocks.push({ highlightType: CodeHighlightType.STRING, codeContent: match[2] })
		} else if (match[3]) {
			blocks.push({
				highlightType: keywords.has(match[3]) ? CodeHighlightType.KEYWORD : CodeHighlightType.METHOD,
				codeContent: match[3]
			})
		} else if (match[4]) {
			blocks.push({
				highlightType: keywords.has(match[4]) ? CodeHighlightType.KEYWORD : CodeHighlightType.DEFAULT,
				codeContent: match[4]
			})
		} else if (match[5]) {
			blocks.push({ highlightType: CodeHighlightType.NUMBER, codeContent: match[5] })
		} else {
			blocks.push({ highlightType: CodeHighlightType.DEFAULT, codeContent: match[6] })
		}
	}
	return blocks
}

export const toUnified = (submessages: any[]) => ({
	response_id: randomUUID(),
	sections: submessages.map((submessage) => {
		switch (submessage.messageType) {
			case RichSubMessageType.CODE: {
				const codeMetadata = submessage.codeMetadata
				return {
					view_model: {
						primitive: {
							language: codeMetadata.codeLanguage,
							code_blocks: codeMetadata.codeBlocks.map((block: any) => ({ content: block.codeContent, type: CodeHighlightType[block.highlightType] })),
							__typename: 'GenAICodeUXPrimitive'
						},
						__typename: 'GenAISingleLayoutViewModel'
					}
				}
			}
			case RichSubMessageType.TABLE: {
				const tableMetadata = submessage.tableMetadata
				return {
					view_model: {
						primitive: {
							title: tableMetadata.title,
							rows: tableMetadata.rows.map((row: any) => ({ is_header: row.isHeading, cells: row.items, markdown_cells: [] })),
							__typename: 'GenATableUXPrimitive'
						},
						__typename: 'GenAISingleLayoutViewModel'
					}
				}
			}
			case RichSubMessageType.TEXT:
				return {
					view_model: {
						primitive: {
							text: submessage.messageText,
							inline_entities: submessage.inlineEntities || [],
							__typename: 'GenAIMarkdownTextUXPrimitive'
						},
						__typename: 'GenAISingleLayoutViewModel'
					}
				}
		}
		return submessage
	})
})

export const botMetadataSignature = () => {
	const signature = new Uint8Array(64)
	getRandomValues(signature)
	return signature
}

export const botMetadataCertificate = (length = 700) => {
	const certificate = new Uint8Array(length)
	certificate[0] = 48
	certificate[1] = 130
	getRandomValues(certificate.subarray(2))
	return certificate
}

export const wrapToBotForwardedMessage = (richResponseMessage: proto.IAIRichResponseMessage) => ({
	messageContextInfo: {
		deviceListMetadata: { senderAccountType: 2 },
		botMetadata: {
			pluginMetadata: {},
			verificationMetadata: {
				proofs: [
					{
						certificateChain: [botMetadataCertificate(684), botMetadataCertificate(892)],
						version: 1,
						useCase: 1,
						signature: botMetadataSignature()
					}
				]
			},
			botInfrastructureDiagnostics: { toolsUsed: [], botBackend: 1 },
			botModeSelectionMetadata: { mode: [], overrideMode: [0] },
			botRenderingConfigMetadata: BOT_RENDERING_CONFIG_METADATA
		}
	},
	botForwardedMessage: {
		message: { richResponseMessage }
	}
})

export const prepareRichResponseMessage = (content: {
	code?: string
	contentText?: string
	disclaimerText?: string
	footerText?: string
	headerText?: string
	language?: string
	links?: { url?: string; text: string; title?: string; displayName?: string; subtitle?: string; sources?: { displayName?: string; subtitle?: string; url?: string }[] }[]
	noHeading?: boolean
	richResponse?: any[]
	table?: string[][]
	title?: string
}) => {
	const { code, contentText, disclaimerText, footerText, headerText, language, links, noHeading, richResponse, table, title } = content
	let submessages: any[] = []

	if (Array.isArray(richResponse)) {
		submessages = richResponse.map((submessage) => {
			if (submessage.text) {
				return { messageType: RichSubMessageType.TEXT, messageText: submessage.text, inlineEntities: submessage.inlineEntities }
			} else if (submessage.code) {
				return { messageType: RichSubMessageType.CODE, codeMetadata: { codeLanguage: submessage.language, codeBlocks: submessage.code } }
			} else if (submessage.table) {
				return { messageType: RichSubMessageType.TABLE, tableMetadata: { title: submessage.title, rows: submessage.table } }
			}
			return submessage
		})
	} else {
		if (headerText) submessages.push({ messageType: RichSubMessageType.TEXT, messageText: headerText })
		if (contentText) submessages.push({ messageType: RichSubMessageType.TEXT, messageText: contentText })

		if (code) {
			const lang = language || 'javascript'
			submessages.push({ messageType: RichSubMessageType.CODE, codeMetadata: { codeLanguage: lang, codeBlocks: tokenizeCode(code, lang) } })
		} else if (links) {
			links.forEach((linkField, index) => {
				const prefix = 'SS_' + index
				const url = linkField.url || DONATE_URL
				const sources = linkField.sources?.map(s => ({
					source_type: 'THIRD_PARTY',
					source_display_name: s.displayName || 'Source',
					source_subtitle: s.subtitle || '',
					source_url: s.url || url
				}))
				submessages.push({
					messageType: RichSubMessageType.TEXT,
					messageText: linkField.text + ` {{${prefix}}}¹{{/${prefix}}} `,
					inlineEntities: [{
						key: prefix,
						metadata: {
							reference_id: index + 1,
							reference_url: url,
							reference_title: linkField.title || 'Source',
							reference_display_name: linkField.displayName || 'Source',
							sources: sources || [],
							__typename: 'GenAISearchCitationItem'
						}
					}]
				})
			})
		} else if (table) {
			submessages.push({
				messageType: RichSubMessageType.TABLE,
				tableMetadata: {
					title,
					rows: table.map((items, index) => ({ isHeading: !noHeading && index === 0, items }))
				}
			})
		}

		if (footerText) submessages.push({ messageType: RichSubMessageType.TEXT, messageText: footerText })
	}

	const unified = toUnified(submessages)

	const richResponseMessage = proto.AIRichResponseMessage.create({
		submessages,
		messageType: proto.AIRichResponseMessageType.AI_RICH_RESPONSE_TYPE_STANDARD,
		unifiedResponse: {
			data: Buffer.from(JSON.stringify(unified), 'utf-8')
		},
		contextInfo: {
			isForwarded: true,
			forwardingScore: 1,
			forwardedAiBotMessageInfo: { botJid: '867051314767696@bot' },
			forwardOrigin: 4
		}
	})

	const message = wrapToBotForwardedMessage(richResponseMessage)
	const botMetadata = (message.messageContextInfo as any).botMetadata

	if (disclaimerText) {
		botMetadata.messageDisclaimerText = disclaimerText
	}
	botMetadata.botResponseId = unified.response_id

	return message
}
