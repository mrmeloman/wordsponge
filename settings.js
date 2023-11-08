document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['words'], (result) => {
    if (result.words) {
      const wordList = Object.entries(result.words)
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n');
      document.getElementById('wordList').value = wordList;
    }
  });
});

document.getElementById('saveButton').addEventListener('click', () => {
  const wordList = document.getElementById('wordList').value.split('\n');
  const words = {};
  wordList.forEach(line => {
    const [key, value] = line.split(/: ?/).map(item => item.trim());
    if (key && value) words[key] = value;
  });
  chrome.storage.local.set({ words: words }, () => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError);
      document.querySelector('.results').innerHTML = chrome.runtime.lastError.message;
    } else {
      console.log('Words saved successfully.');
      document.querySelector('.results').innerHTML = 'Words saved successfully.';
    }
  });
});

document.getElementById('updateWordsButton').addEventListener('click', () => {
  var selectedLanguage = document.getElementById('languageSelect').value;
  
  //If 'Custom' is selected - do not fetch from thewordsponge.com
  if (selectedLanguage == 'Custom') {
	  document.querySelector('.update_results').innerHTML = 'Nothing changed as Custom language is selected. Select other language to download word list from wordsponge.com';
	  return;
  }
  
  var url = 'https://thewordsponge.com/sponge/words/' + selectedLanguage;
  fetch(url, { credentials: 'include' })
      .then(response => {
        console.log(response.body);
        return response.json();
      })
      .then(data => {
        chrome.storage.local.set({ words: data }, () => {
          if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError);
          } else {
			  console.log('Word list fetched successfully');
			  document.querySelector('.update_results').innerHTML = 'Word list updated successfully. Language selected: ' + selectedLanguage;
		  }
        });
      });
});

document.getElementById('languageSelect').addEventListener('change', function() {
  var selectedLanguage = this.value;
  chrome.storage.local.set({ 'language': selectedLanguage }, function() {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError);
    }
  });
});

function loadLanguageSetting() {
  chrome.storage.local.get('language', function(data) {
    if (data.language) {
      document.getElementById('languageSelect').value = data.language;
      console.log('Language setting loaded:', data.language);
    }
  });
}
document.addEventListener('DOMContentLoaded', loadLanguageSetting);