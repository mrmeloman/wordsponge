# Word Sponge

Word Sponge is a Chrome and Firefox extension that helps you learn a new language by replacing words on web pages with their translations. Simply download the extension, choose the language you want to learn, and start browsing the web!

## Features

- Easy installation and setup
- Choose from a variety of languages to learn
- Replace words on any web page with their translations
- Click on translated words to switch back to the original word
- Control how often words are replaced: Light, Balanced, Intense or Everything, or your own limits
- Add your own words by hand or upload a word list file (.txt, .csv, .tsv or .json)
- Works fully offline with your own words by default; downloading word lists from thewordsponge.com is an opt-in that refreshes once a day
- Only replaces words in regular text, not in attributes such as classes or data tags
- Does not replace words inside `<a>` tags or `<input>` tags
- Uses local storage to store the words list, avoiding unnecessary requests to the server
- Follows strict privacy and security guidelines and policies of the Chrome Web Store
- Works in Chrome (Manifest V3, Chrome 121 or newer) and Firefox (140 or newer) from the same code

## Installation Now

The easiest way is the [latest release](https://github.com/mrmeloman/wordsponge/releases/latest), which has a package for Chrome and one for Firefox, each with install steps. To install from this repository instead:

1. Download the wordsponge.zip file.
2. Extract the contents of the zip file to a folder on your computer.
3. Open Google Chrome and navigate to the extensions page by typing chrome://extensions into the address bar.
4. Enable Developer mode by clicking the toggle switch in the top-right corner of the page.
5. Click on the "Load unpacked" button in the top-left corner of the page.
6. Navigate to the folder where you extracted the zip file, and select it.
7. Click on the "Select Folder" button to load the extension.

### Firefox

1. Download the wordsponge.zip file.
2. Open Firefox and navigate to about:debugging#/runtime/this-firefox.
3. Click "Load Temporary Add-on..." and select the zip file (or the manifest.json from the extracted folder).
4. A temporary add-on is removed when Firefox closes. To keep it, sign the zip through [addons.mozilla.org](https://addons.mozilla.org/developers/) and install the signed file.

## Installation

1. Go to the [Chrome Web Store](https://chromewebstore.google.com/detail/word-sponge/kiphhbngjiidccgcebflhlmmabighbem) page for Word Sponge.
2. Click on the "Add to Chrome" button to add the extension to your browser.
3. Once installed, click on the Word Sponge icon in the top-right corner of your browser to open the options page.
4. Choose the language you want to learn from the dropdown menu, and click on "Save" to update your preferences.

That's it! You're now ready to start browsing the web and learning a new language.

## Usage

- Navigate to any web page in your browser.
- Any words on the page that match the words list for your chosen language will be replaced with their translations.
- Click on a translated word to switch back to the original word.
- Use the toggle in the extension popup to turn Word Sponge off for the current site.

## Your Own Words

Open the extension's settings (the "Settings" link in the popup, or the add-on's options page) to manage your own word list. By default the extension is fully local: it never contacts thewordsponge.com and uses only the words you add here. Your words are kept separately from any downloaded list and take priority over it, so they survive the daily update.

- Type words directly into the text box, one per line, as `word: translation`, and click "Save".
- Or upload a file. Text files (.txt, .csv, .tsv) take one pair per line separated by a colon, tab, comma or semicolon; lines starting with `#` are ignored. JSON files take either an object such as `{"cat": "gato"}` or an array of `["cat", "gato"]` pairs. Uploaded words are added to the list in the text box.
- To use the ready-made lists from thewordsponge.com instead, tick "Download word lists from thewordsponge.com" in settings. The browser then asks for permission to access that site; untick it to go back to local-only mode.

## How Often Words Are Replaced

Pick an intensity from the extension popup, or fine-tune it in settings. Changes apply to open pages right away.

| Intensity | Share of matching words | Same word per page | Words per page |
|---|---|---|---|
| Light | about 30% | once | up to 10 |
| Balanced | about 50% | up to 2 times | up to 30 |
| Intense | about 80% | up to 5 times | up to 100 |
| Everything (default) | all | no limit | no limit |

Choose "Custom" in settings to set the three limits yourself; leave a number empty for no limit. When limits apply, the replaced words are picked at random across the whole page, so each visit practises different ones.

## Releases

To publish a release, add a section for the new version to CHANGELOG.md and raise the version in manifest.json. When that reaches the main branch, a GitHub Actions workflow builds a Chrome package and a Firefox package and publishes them as a release. It can also be run by hand from the Actions tab.

The Firefox package is unsigned unless the repository has the secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`, which are API credentials from the [addons.mozilla.org developer hub](https://addons.mozilla.org/developers/addon/api/key/). With them, the workflow has the package signed by Mozilla for self-distribution, so it installs permanently in Firefox and Firefox-based browsers. If you add them after a release was published, run the workflow by hand from the Actions tab: it rebuilds that release from its tag and adds the signed package.

## Contributing

If you'd like to contribute to Word Sponge, please fork the repository and submit a pull request. All contributions are welcome, including bug fixes, feature requests, and translations for additional languages. Please note that by submitting a contribution, you agree to license your contribution for free to the creators and under any additional licenses we add to this project in the future.

## Forking Your Own

If you'd like to fork your own, you can do so easily by forking this repository. You could, for example, add word lists directly into the extension.
My version of the extension checks for updates to the word list every 24 hours from [thewordsponge.com](https://thewordsponge.com), but you could host your
own site or use a different method to update the word list.

## How to Change Language

1. Install the extension and enable downloads in its settings
2. Go to "thewordsponge.com" and click a new language
3. Click the "confirm" button too.
