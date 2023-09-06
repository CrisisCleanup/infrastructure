import chrome from '@sparticuz/chromium'
import type { APIGatewayEvent } from 'aws-lambda'
import puppeteer, { type Browser } from 'puppeteer-core'
import { z } from 'zod'

const schema = z
	.object({
		content: z.string().describe('Raw HTML content to render'),
		width: z.number().optional().describe('Width of the PDF in pixels'),
		height: z.number().optional().describe('Height of the PDF in pixels'),
	})
	.partial({ width: true, height: true })

const doRender = async (
	browser: Browser,
	props: z.infer<typeof schema>,
): Promise<string> => {
	const { content, height, width } = props
	const dimensions = {
		...(width ? { width } : {}),
		...(height ? { height } : {}),
	}

	const page = await browser.newPage()
	if (width || height) {
		await page.setViewport({
			...(dimensions as { height: number; width: number }),
		})
	}
	await page.setContent(content)

	const pdf = await page.pdf({
		...dimensions,
		format: 'A4',
	})
	return pdf.toString('base64')
}

export async function handler(event: APIGatewayEvent) {
	console.log('Incoming event:', event)

	const payload = await schema.parseAsync(JSON.parse(event.body!))
	console.log('Received payload:', payload)

	const browser = await puppeteer.launch({
		// @ts-ignore
		// eslint-disable-next-line @typescript-eslint/await-thenable,@typescript-eslint/unbound-method
		executablePath: await chrome.executablePath,
		headless: chrome.headless,
		args: chrome.args,
	})

	try {
		const pdf = await doRender(browser, payload)
		return {
			statusCode: 200,
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': 'attachment; filename="result.pdf"',
			},
			body: pdf,
		}
	} catch (e: unknown) {
		console.error('Error rendering PDF:', e)
		return {
			statusCode: 500,
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				error: e instanceof Error ? e.message : String(e),
			}),
		}
	} finally {
		console.log('Closing browser')
		await browser.close()
	}
}
