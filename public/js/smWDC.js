(function(){

//-------------------------------------------------- //
// OAuth Code
//-------------------------------------------------- //
var config = {
 	//redirect_uri: 'https://hidden-brook-61122.herokuapp.com/redirect',
	redirect_uri: 'http://localhost:3333/redirect',
	client_id: 'sm_cajmera', 
 	response_type: 'code',
	api_key: '5gaqqv7equm9cbv9w7xv8zpb'
}

var api_url =  {
	survey_list : '/v2/surveys/get_survey_list?',
	survey_details : '/v2/surveys/get_survey_details?',
	respondent_list : '/v2/surveys/get_respondent_list?',
	oauth : '/oauth/authorize',
	api_key : jQuery.param({api_key: config.api_key}),
	base : 'https://api.surveymonkey.net'
}

var answersLookup;
var respondentsList;

$(document).ready(function() {
	var accessToken = Cookies.get("smAccessToken");
	$('#login').click(function(){
		var url =  api_url.base +  api_url.oauth + '?' + jQuery.param(config);
		window.location = url; 
	});
	
	$("#getDataButton").click(function() {
		tableau.submit();
	});

	var hasAuth = isAccessTokenValid(accessToken);
	update_Auth_displays(hasAuth);

	if (hasAuth){
		request_survey_list(accessToken);
	}

	$('#getDataButton').prop('disabled', true);	
});


//-------------------------------------------------- //
//WDC Connector Definitions
//-------------------------------------------------- //
var myConnector = tableau.makeConnector();

myConnector.init = function(initCallback) {	
	var accessToken = Cookies.get("smAccessToken");

	var hasAuth = isAccessTokenValid(accessToken) || tableau.password.length > 0;

	if (tableau.phase == tableau.phaseEnum.interactivePhase || tableau.phase == tableau.phaseEnum.authPhase) {
		if (hasAuth) {	
			tableau.password = accessToken;
		}
	} else {
		if (!hasAuth) {
			tableau.abortWithError("Don't have an access token. Giving up");
		}
	}
	update_Auth_displays(hasAuth); 

	initCallback();
};

myConnector.getSchema = function(schemaCallback) {
    // Create a promise to get our Standard Connections List from a JSON file. This increases code readability since we
    // no longer need to define the lengthy object within our javascript itself.
    var standardConnections = new Promise(function(resolve, reject) {
		loadJSON("../StandardConnectionsData", function(json) {
			var obj = JSON.parse(json);
			var connectionList = [];
			for (var connection in obj.connections) {
				connectionList.push(obj.connections[connection]);
			}
			resolve(connectionList);
		}, true);
    });
    // Create a promise to get our table schema info as well, just like above
    var tables = new Promise(function(resolve, reject) {
		loadJSON("../schema", function(json) {
			var obj = JSON.parse(json);
			var tableList = [];
			for (var table in obj.tables) {
				tableList.push(obj.tables[table]);
			}
			resolve(tableList);
		}, true);
    });
    // Once all our promises are resolved, we can call the schemaCallback to send this info to Tableau
    Promise.all([tables, standardConnections]).then(function(data) {
      schemaCallback(data[0], data[1]);
    });
};

myConnector.getData = function(table, doneCallback) {
    var accessToken = tableau.password; 
	var survey_id = tableau.connectionData;
	
	var surveyPromise =  getSurveyDetails(survey_id, accessToken);
	var respondentPromise = getRespondentList(survey_id, accessToken);
	var answersPromise;
	
	if (table.tableInfo.id === "questions") {
		surveyPromise.then(function(data) {
			table.appendRows(data);
			doneCallback();
		}, function(error) {
			tableau.abortWithError(error);
		});
	} else if (table.tableInfo.id === "respondents") {
		respondentPromise.then(function(data) {
			table.appendRows(data);
			doneCallback();
		}, function(error) {
			tableau.abortWithError(error);
		});
	} else if (table.tableInfo.id === "answers") {
		if (!answersLookup) {
			surveyPromise.then(function(data) {
	 			answersPromise = getAnswers(survey_id, accessToken);
				answersPromise.then(function(data) {
					table.appendRows(data);
					doneCallback();
				}, function(error) {
					tableau.abortWithError(error);
				});
			}, function(error) {
				tableau.abortWithError(error);
			});
		} else {
 			answersPromise = getAnswers(survey_id, accessToken);
			answersPromise.then(function(data) {
				table.appendRows(data);
				doneCallback();
			}, function(error) {
				tableau.abortWithError(error);
			});
		}
	}
};


tableau.registerConnector(myConnector);

// Survey monkey returns either a string "undfined" or undefined depending 
// on which environment the app is running (draft vs prod).  Very weird.
function isAccessTokenValid(accessToken) {
	return !_.isUndefined(accessToken) && accessToken !== "undefined";
}

function loadJSON(path, cb, isLocal) {
  var obj = new XMLHttpRequest();
  obj.overrideMimeType("application/json");
  if(isLocal) {
    obj.open("GET", "../json/" + path + ".json", true);
  }
  else {
    obj.open("GET", "https://crossorigin.me/http://jsonplaceholder.typicode.com/" + path, true);
  }
  obj.onreadystatechange = function() {
    if (obj.readyState == 4 && obj.status == "200"){
      cb(obj.responseText);
    }
  }
  obj.send(null);
}

//-------------------------------------------------- //
// UI Helpers
//-------------------------------------------------- //

/*
update_Auth_displays is called upon initiation of the page
to display appropriate UI elements.
*/
function update_Auth_displays(hasAuth){
	if (hasAuth) {
		$("#notsignedin").css('display', 'none');
		$("#signedin").css('display', 'inline');
		$("#getDataButton").css('display', 'block');
		$("#surveyTable").css('display', 'grid');
		$("#login").css('display', 'none');
		$("#surveyLabel").css('display', 'block');
		$("#tableWrapDiv").css('display', 'block');
		$("#search").css('display', 'block');
	} else {
		$("#notsignedin").css('display', 'inline');
		$("#signedin").css('display', 'none');
		$("#getDataButton").css('display', 'none');
		$("#surveyTable").css('display', 'none');
		$("#login").css('display', 'block'); 
		$("#surveyLabel").css('display', 'none');
		$("#tableWrapDiv").css('display', 'none');
		$("#search").css('display', 'none');
	}
};

/* 
parse_survey_list turns the list of surveys into 
html elements. 
*/
function parse_survey_list(surveys){
	clearTable();
	surveys.sort(date_compare); //sort by date modified
	
	if(surveys.length == 0) {
		$("#surveyTable").last().append("<tr class='tableRow'><td>No surveys found for this account</td><td><td></tr>");
	}
	
	for (i = 0; i < surveys.length; i++){
		$("#surveyTable").last().append("<tr class='tableRow'><td class='titleColumn'>" + surveys[i].title +
										"</td><td class='dateColumn'>" + surveys[i].date_modified + 
										"</td><td class='idColumn'>" + surveys[i].survey_id +
										"</td></tr>");
	}
	
	addTableHandlers();
};

function clearTable() {
  $('#surveyTable tr').slice(1).remove();
}

function clearSelected() {
  $("table#myTable tr").removeClass("selected");
}

/*
helper function for sorting by date-modified
*/
function date_compare(survey1, survey2){
	var date1 = new Date(survey1.date_modified);
	var date2 = new Date(survey2.date_modified); 
	return -(date1-date2); 
}

function addTableHandlers() {
  $("tbody").on("click", "tr", function(e) {
    var index = $("tr").index($(this));
    $('#getDataButton').prop('disabled', false);
    $(this)
       .addClass("selected")
       .siblings(".selected")
       .removeClass("selected");
	   
	tableau.connectionName = 'Survey Monkey Data: ' + $(this).find(".titleColumn").html();  
	tableau.connectionData = $(this).find(".idColumn").html(); 
  });

  $("#search").on("keyup", function() {
    clearSelected();
    var value = $(this).val().toLowerCase();

    $("table tr").each(function(index) {
        if (index !== 0) {

            $row = $(this);

            var title = $row.find("td:first").text().toLowerCase();;

            if (title.indexOf(value) !== 0) {
                $row.hide();
            }
            else {
                $row.show();
            }
        }
    });
  });
}


//-------------------------------------------------- //
// Request Helpers
//-------------------------------------------------- //

/*
Once the user is authenticated, request_survey_list is called
to request the list of surveys on the users account. 
The returned list is sorted by date-modified
*/
function request_survey_list(accessToken){
	var param = {api_key: config.api_key};
	var req_url = api_url.base + api_url.survey_list + api_url.api_key;
	var xhr = $.ajax({
		url: req_url,
		type: 'POST',
		data: '{"fields": ["title", "date_modified"]}',
		dataType: 'json',
		contentType: 'application/json',
		headers: {
			'Authorization': 'bearer ' + accessToken,
			'Content-Type': 'application/json'
		},
		sucess: function(data, textStatus, jqXHR){
			console.error(textStatus);
			
		},
		error: function(xhr, ajaxOptions, thrownError){
			console.error('error!');
		},
		complete:function(jqXHR, textStatus){
			if (textStatus != 'success' || jqXHR.responseJSON.errmsg ) {
				console.error('surveylist api failed'); 
			}
			parse_survey_list(jqXHR.responseJSON.data.surveys); 		
        }
	});
};

/*
calls the get_survey_details api
*/
function getSurveyDetails(survey_id, accessToken){
	return new Promise(function(resolve, reject) {
		var req_url = api_url.base + api_url.survey_details + api_url.api_key;
		//console.log(req_url);
		var xhr = $.ajax({
			url: req_url,
			type: 'POST',
			data: '{"survey_id": "' + survey_id + '"}',
			dataType: 'json',
			contentType: 'application/json',
			headers: {
				'Authorization': 'bearer ' + accessToken,
				'Content-Type': 'application/json'
			},
			complete:function(jqXHR, textStatus){
				if (textStatus != 'success' || jqXHR.responseJSON.errmsg ) {
                	Promise.reject("error in getSurveyDetails: " + thrownError);
				}
				
				var data = parse_survey_details(jqXHR.responseJSON.data);
				resolve(data); 
			}
		});
	});
};


/*
parse_survey_details takes the result from get_survey_details api
and parses for the question names and responses.
(hashtables from id to question name and id to answer is needed because 
the get_responses api returns question_ids and answer_ids)
*/
function parse_survey_details(data){
	var page, question, type, answer; 
	var questions = []; 
	var id_to_answer_name = {}; 
	for (i = 0; i < data.pages.length; i++){
		page = data.pages[i];
		for (j = 0; j < page.questions.length; j++){
			question = page.questions[j]; 
			type = question.type.family;
			if (type === 'single_choice'){
				questions.push([question.question_id, clean_name(question.heading)]); 
				for  (k = 0; k < question.answers.length; k++){
					answer = question.answers[k];
					if (answer.type === 'other'){ //extra comment box or custom option
						var header = question.heading + ' - ' + answer.text + '(comment)'; 
						header = clean_name(header); 
						questions.push([question.question_id + '0', header]);
					} else {
						id_to_answer_name[answer.answer_id] = answer.text;
					}
				}
			} else if (type === 'multiple_choice'){
				questions.push([question.question_id, clean_name(question.heading)]); 
				for  (k = 0; k < question.answers.length; k++){
					answer = question.answers[k];
					if (answer.type === 'other'){ //extra comment box or custom option 
						var header = question.heading + ' - ' + answer.text + '(comment)'; 
						header = clean_name(header); 
						questions.push([question.question_id + '0', header]);
					} else {
						id_to_answer_name[answer.answer_id] = answer.text;
					}
				}
			} else if (type === 'open_ended'){
				//do a if text when parsing
				if (question.answers.length === 0){
					questions.push([question.question_id, clean_name(question.heading)]); 
				} else {
					for  (k = 0; k < question.answers.length; k++){
						answer = question.answers[k];
						var header = question.heading + ' - ' + answer.text; 
						header = clean_name(header);
						questions.push([answer.answer_id, header]); 
					}
				}
			} else if ( type === 'datetime'){
				for  (k = 0; k < question.answers.length; k++){
					answer = question.answers[k];
					var header = question.heading + ' - ' + answer.text.trim(); 
					header = clean_name(header);
					questions.push([answer.answer_id, header]); 
				}
			} else if (type === 'demographic'){
				//do a if text when parsing
				for  (k = 0; k < question.answers.length; k++){
					answer = question.answers[k];
					var header = question.heading + ' - ' + answer.text.trim(); 
					header = clean_name(header);
					questions.push([answer.answer_id, header]); 
				}
				
			} else if (type === 'matrix'){
				for (k = 0; k < question.answers.length; k++){
					answer = question.answers[k]; 
					if (answer.type === 'col'){
						id_to_answer_name[answer.answer_id] = answer.text; 
					} else if (answer.type === 'row') {
						var header = question.heading + ' - ' + answer.text; 
						header = clean_name(header);
						questions.push([answer.answer_id, header]); 
					} else if (answer.type === 'other'){ 
						var header = question.heading + ' - ' + answer.text + '(comment)'; 
						header = clean_name(header); 
						questions.push([question.question_id + '0', header]);
					} else {
						console.log('unsupported answer type in matrix');
					}
				}
			} else {
				console.log('unsupported type detected');
			}

		}
	}
	
	answersLookup = id_to_answer_name; 
	return questions;
};

function flattenMap(map) {
	var arr = [];
	_.forEach(Object.keys(map), function(key) {
		arr.push([key, map[key]]);
	});
	return arr;
}

/*
clean_name function is just a backup utility incase there exists 
characters that are uncompatiable with Tableau Data Engine. 
*/
function clean_name(name){
	//name = name.replace(/[`~!@#$%^&*()_|+\-=?;:'",.<>\{\}\[\]\\\/]/gi, '');
	return name;
};

/*
getRespondentList gets a list of respondent_ids for a survey.
*/
function getRespondentList(survey_id, accessToken){
	return new Promise(function(resolve, reject) {
		var respondent_ids = []; 
		var req_url = api_url.base + api_url.respondent_list + api_url.api_key;
		var respondents;
		var results = [];
		var request_body = {}; 
		var request_fields = ["date_modified"]; 
		
		
		request_body["survey_id"] = survey_id; 
		request_body["fields"] = request_fields; 
		var xhr = $.ajax({
			url: req_url,
			type: 'POST',
			data: JSON.stringify(request_body),
			dataType: 'json',
			contentType: 'application/json',
			headers: {
				'Authorization': 'bearer ' + accessToken,
				'Content-Type': 'application/json'
			},
			complete:function(jqXHR, textStatus){
				if (textStatus != 'success' || jqXHR.responseJSON.errmsg ) {
					Promise.reject('respondents api failed, your survey probably has not been taken by anyone'); 
				}
				data = jqXHR.responseJSON.data;
				respondents = jqXHR.responseJSON.data.respondents; 
				
				respondentsList = [];
				_.forEach(respondents, function(respondent) {
					results.push([respondent["respondent_id"], respondent["date_modified"]]);
					respondentsList.push(respondent["respondent_id"]);
				});
							
				
				resolve(results);
			}
		});
	});
};

function getAnswers(survey_id, accessToken){
	return new Promise(function(resolve, reject) {
		var answers = []; 
		var answerId = 0;
		
		var respondentId;
		var questionId;
		var answerValue;
		
		var req_url = "https://api.surveymonkey.net/v3/surveys/" + survey_id + "/responses/bulk?" + api_url.api_key;

		var xhr = $.ajax({
			url: req_url,
			type: 'GET',
			dataType: 'json',
			contentType: 'application/json',
			headers: {
				'Authorization': 'bearer ' + accessToken,
				'Content-Type': 'application/json'
			},
			complete:function(jqXHR, textStatus){
				if (textStatus != 'success' || jqXHR.responseJSON.errmsg ) {;
					Promise.reject(jqXHR.responseJSON.errmsg); 
				}

				// Iterate over each response
				_.forEach(jqXHR.responseJSON.data, function(respondent) {
					respondentId = respondent.id
					
					// Iterate over each page in the response
					_.forEach(respondent.pages, function(page) {
						// Iterate over each question in that page
						_.forEach(page.questions, function(question) {
							questionId = question.id;
							
							// Each question may have multiple answers
							_.forEach(question.answers, function(answer) {	
								if (answersLookup) {
									answerValue = answersLookup[answer.choice_id];
								} else {
									console.error("something went wrong, answersLookup shouldn't be undefined");
								}		
										
								answers.push({
		                            'ID': answerId++,
									'QID': questionId,
									'RID': respondentId,
									'RowID': answer.row_id,
									'ChoiceID': answer.choice_id,
									'Text': answerValue,
									'FreeformText': answer.text
								})
							});
	 					});
	 				});
				});
					
				resolve(answers);
			}
		});
	});
};

/*
parse_responses parses the responses from get_responses api and fills
the rows in the data table
*/
function parse_responses(data_array){
	var data_transferred = JSON.parse(tableau.connectionData);
	var id_to_question_name = data_transferred[1]; 
	var id_to_answer_name = data_transferred[2];
	var resp_id_to_date = data_transferred[3];
	data = data_array; 
	var question, answers, entry, respondents, respondent; 
	var toReturnData = []; 
	var entry;
	var date_modified; 

	for (i = 0; i < data_array.length; i++){
		respondents = data_array[i]; 
		for (j = 0; j < respondents.length; j++){
			respondent = respondents[j]; 
			date_modified = resp_id_to_date[respondent.respondent_id]; 
			for (k = 0; k < respondent.questions.length; k++){
				question = respondent.questions[k]; 
				answers = question.answers; 
				if (answers[0].text){ 
					if (answers[0].row ==='0') { //single comment box; 
						entry = fill_entry(respondent.respondent_id, id_to_question_name[question.question_id], answers[0].text, date_modified); 
						toReturnData.push(entry);
					} else { //multiple comment boxes 
						for (l = 0; l < answers.length; l++){
							entry = fill_entry(respondent.respondent_id, id_to_question_name[answers[l].row], answers[l].text, date_modified); 
							toReturnData.push(entry);
						}
					}
				} else if (question.answers[0].col){ //matrix 
					for (l = 0; l < answers.length; l++){
						if (answers[l].row === '0'){
							entry = fill_entry(respondent.respondent_id, id_to_question_name[question.question_id + '0'], answers[l].text, date_modified);
						} else {
							entry = fill_entry(respondent.respondent_id, id_to_question_name[answers[l].row], id_to_answer_name[answers[l].col], date_modified); 
						}
						toReturnData.push(entry);
					} 
				} else { //single choice or multiple choice questions 
					for (l = 0; l < answers.length; l++){
						var response; 
						if (answers[l].row === '0') { //this is a comment not a choice
							entry = fill_entry(respondent.respondent_id, id_to_question_name[question.question_id + '0'], answers[l].text, date_modified);
						} else {
							if (answers[l].text){
								response = answers[l].text; // when user is given the option to enter custom choice
							} else {
								response = id_to_answer_name[answers[l].row];
							}
							entry = fill_entry(respondent.respondent_id, id_to_question_name[question.question_id], response, date_modified);
						}
						toReturnData.push(entry);
					}
				}
			}
		}
	}
	tableau.dataCallback(toReturnData, toReturnData.length.toString(), false);
};

/*
fill_entry is a helper function to create entries
*/
function fill_entry(respondent_id, question, answer, date_modified){
	var entry = {}; 
	entry['respondent_id'] = respondent_id; 
	entry['question_name'] = question; 
	entry['question_response'] = answer;
	entry['date_modified'] = check_if_date(date_modified);
	return entry;
}

/*
helper function to convert dates to the right format for tableau 
*/
function check_if_date(dateToConvert){
	var moDate = moment(dateToConvert).format("YYYY-MM-DD HH:mm:ss.SSS");
	if (moDate === 'Invalid date'){
		return dateToConvert; 
	} else {
		return moDate;
	}
}
})();
