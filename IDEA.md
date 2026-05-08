Let's plan out the IDEA.md first. Phase 1, we want to create a single page. This page will dynamically render text like a teleprompter, greying out and focusing text as it streams. Input -> a sentence, streamed. Output -> Single page (no scrolling) display of text like a teleprompter.

Phase 2, we want functions or scripts to generate or call codex exec to generate images. This images can be svg or something pretextjs can work with to achieve that fluid dragon animation explained in REPORT.md.

Phase 3, In phase 1, we must be able to stream text, and store text somewhere OR stream it to Openai voice-to-action apis, or codex. The provider will understand the sentence streamed, generate the teleprompt script (at least the next paragraph worth of text, within context), along with a background job of GPT Image 2 (can do this with Codex exec) generating (basically phase 2).

Phase 4, we integrate voice-to-action. Where all the previous 3 stages come together and the entrypoint is speech

How it works, think of it like an unplanned presentation

1. I start with a sentence giving context "Today I will be demoing XXX. We can now do interactive demos without preparing for it."
2. While I'm saying the sentence, beautiful text shows up and streams into that landing page
3. While I'm saying the sentence, LLM understands the sentence, gets the context, then generates the next paragraph for me to say. 
4. Since the LLM provides the paragraph, it can also pre-generate images or SVGs in advance, so when I read the paragraph, by the time i say a relevant sentence, beautiful things can show up. For example the paragraph says "This means I can demo products, and while i speak, make unicorns fly across the screen, or a beautiful forest appears...". So before i even speak the sentence, AI already starts generating the unicorns and adapting it to fly across the screen, and pre generating the forest background.
5. What the audience sees is a landing page that is dynamic and keeps changing while I speak.
