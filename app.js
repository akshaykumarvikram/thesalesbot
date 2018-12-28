
/*-----------------------------------------------------------------------------
A simple Language Understanding (LUIS) bot for the Microsoft Bot Framework. 
-----------------------------------------------------------------------------*/

var restify = require('restify');
var builder = require('botbuilder');
var botbuilder_azure = require("botbuilder-azure");
var cog = require('botbuilder-cognitiveservices');
//var customerPainSurveyJson = require("./resources/customerPainSurvey.json")

// Setup Restify Server
var server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
   console.log('%s listening to %s', server.name, server.url); 
});
  
// Create chat connector for communicating with the Bot Framework Service
var connector = new builder.ChatConnector({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword,
    openIdMetadata: process.env.BotOpenIdMetadata 
});

// Listen for messages from users 
server.post('/api/messages', connector.listen());

/*----------------------------------------------------------------------------------------
* Bot Storage: This is a great spot to register the private state storage for your bot. 
* We provide adapters for Azure Table, CosmosDb, SQL Azure, or you can implement your own!
* For samples and documentation, see: https://github.com/Microsoft/BotBuilder-Azure
* ---------------------------------------------------------------------------------------- */

var tableName = 'botdata';
var azureTableClient = new botbuilder_azure.AzureTableClient(tableName, process.env['AzureWebJobsStorage']);
var tableStorage = new botbuilder_azure.AzureBotStorage({ gzipData: false }, azureTableClient);

// Create your bot with a function to receive messages from the user
// This default message handler is invoked if the user's utterance doesn't
// match any intents handled by other dialogs.
var bot = new builder.UniversalBot(connector, function (session, args) {
    session.send('You reached the default message handler. You said \'%s\'.', session.message.text);
});

bot.set('storage', tableStorage);

// Make sure you add code to validate these fields
var luisAppId = process.env.LuisAppId;
var luisAPIKey = process.env.LuisAPIKey;
var luisAPIHostName = process.env.LuisAPIHostName || 'westus.api.cognitive.microsoft.com';

const LuisModelUrl = 'https://' + luisAPIHostName + '/luis/v2.0/apps/' + luisAppId + '?subscription-key=' + luisAPIKey;

// Create a recognizer that gets intents from LUIS, and add it to the bot
var recognizer = new builder.LuisRecognizer(LuisModelUrl);
bot.recognizer(recognizer);

// QnA recognizer 
var qnaRecognizer = new cog.QnAMakerRecognizer({
    knowledgeBaseId: "ad241d54-dc7f-4806-8d9e-e745aa4a5d32",
    subscriptionKey: "2ed58e10-1717-400b-a1a9-ceeb8d590783"
});

//bot.recognizer(qnaRecognizer);

// Add a dialog for each intent that the LUIS app recognizes.
// See https://docs.microsoft.com/en-us/bot-framework/nodejs/bot-builder-nodejs-recognize-intent-luis 

// Case Study Dialog
bot.dialog('CaseStudyDialog',
    (session, args, next) => {
        var intent = args.intent;
        // Get entites from LUIS
        var offeringType = builder.EntityRecognizer.findEntity(intent.entities, 'offeringType');
        var enterprise = builder.EntityRecognizer.findEntity(intent.entities, 'enterprise');
        var industry = builder.EntityRecognizer.findEntity(intent.entities, 'industry');
        offeringType = offeringType ? offeringType.entity : null;
        enterprise = enterprise ? enterprise.entity : null;
        industry = industry ? industry.entity : null;
        // Trigger Guided Case Study Help if no params are given.
        if(!offeringType && !enterprise && !industry){
            session.replaceDialog('CaseStudyHelpDialog',{'fromHelp':false});
        }else {
            // Based on the provided params fetch available case studies
            var caseStudies = getCaseStudy(offeringType, industry, enterprise);
            if(typeof caseStudies[0] != 'undefined'){
                session.send("Found following case studies related to Offering Type:'%s', Industry:'%s', Enterprise:'%s'.",offeringType,industry,enterprise);
                var msg = buildCaseStudyCarousel(caseStudies,session);
                //session.send(JSON.stringify(caseStudies));
                session.send(msg);
                session.endDialog();
            } else {
                session.send("Sorry, cannot find a case study with given params - Offering Type:'%s', Industry:'%s', Enterprise:'%s'. Please try with different params or type 'Help' to get more info.",offeringType,industry,enterprise);
            } 
        }
        
    })
    .triggerAction({
        matches: 'get_case_study'
    })
    .beginDialogAction('CaseStudyHelpAction', 'CaseStudyHelpDialog', { matches: 'Help' });
    
bot.dialog('CaseStudyHelpDialog',[
    (session,args,next) => {
        var fromHelp = args.fromHelp;
        if(fromHelp){
            // Send this message only if this dialog is triggered through the help
            session.send("Sure, I can help you find the appropriate case study");
        }
        builder.Prompts.choice(session, "There are several available case studies. How would you like to filter Case Studies?", "By Offering Type|By Industry|By Company",{ listStyle: builder.ListStyle.button });
    },
    function(session, results){
        var choice = results.response.entity;
        session.dialogData.filterType = choice;
        var choices;
        switch(choice){
            case 'By Offering Type':
                choices = ['Foundation', 'Migration','DevOps', 'Managed Services', 'Modernization'];
                break;
            case 'By Industry':
                choices = ['Healthcare', 'Financial Services', 'Public Sector', 'Retail', 'Education', 'Non-Profit'];
                break;
            case 'By Company':
                choices = ['Radian','AHA', 'Pierian DX','WICS','Energy Sector','Energy Sector','Telecom','i4C','Ditech','Citrus Pay'];
                break;
            default:
                session.send("Sorry, Incorrect Choice. Please try again later");
                session.endDialog();
                break;
        }
        builder.Prompts.choice(session,"Please select one of the following options",choices,{ listStyle: builder.ListStyle.button });
    },
    function(session,results){
        var filterType = session.dialogData.filterType;
        var choice = results.response.entity;
        var caseStudies;
        switch(filterType){
            case 'By Offering Type':
                caseStudies = getCaseStudy(choice,false,false);
                break;
            case 'By Industry':
                caseStudies = getCaseStudy(false,choice,false);
                break;
            case 'By Company':
                caseStudies = getCaseStudy(false,false,choice);
                break;
            default:
                session.send("Sorry, Incorrect Choice. Please try again later");
                session.endDialog();
                break;
        }
        if(typeof caseStudies[0] == 'undefined'){
            session.send("Sorry, there are no case studies available for the given selection");
            session.send("Note: You can also find case studies by directly typing into the text-box. Eg: 'Find a migration case study' or 'get a modernization healthcare case study. ");
            session.endDialog();
        } else {
            var msg = buildCaseStudyCarousel(caseStudies,session);
            //session.send(JSON.stringify(caseStudies));
            session.send("Here you go. I found the following case studies matching your criteria.");
            session.send(msg);
            session.send("Note: You can also find case studies by directly typing into the text-box. Eg: 'Find a migration case study' or 'get a modernization healthcare case study. ");
            session.endDialog();
        }
        
    }
]);

// Battle Cards Dialog
bot.dialog('BattlecardsDialog',
    function(session,args,next){
        // Extract Entities from LUIS
        var intent = args.intent;
        var offeringType = builder.EntityRecognizer.findEntity(intent.entities, 'offeringType');
        var role = builder.EntityRecognizer.findEntity(intent.entities, 'role');
        offeringType = offeringType ? offeringType.entity : null;
        role = role ? role.entity : null;
        // Triggered Guided BattleCards Dialog of no params are provided
        if(!offeringType && !role){
            session.replaceDialog('BattlecardsHelpDialog',{'fromHelp':false});
        }
        else {
            // Fetch Battlecards based on the provided params
            var battleCards = getBattlecards(offeringType,role);
            if(typeof battleCards[0] != 'undefined'){
                session.send("Found the following battlecard for the given params.\n Offering:'%s', Role:'%s'",offeringType,role);
                var msg = buildBattlecardsCarousel(battleCards,session);
                session.send(msg);
                session.endDialog();
            } else {
                session.send("Sorry, Cannot find battle cards for the given params - Offering: '%s', Role: '%s'",offeringType,role);
            }
        }
    })
    .triggerAction({
        matches: 'get_battle_cards'
    })
    .beginDialogAction('BattlecardsHelpAction', 'BattlecardsHelpDialog', { matches: 'Help' });
bot.dialog('BattlecardsHelpDialog',[
    function(session, args, next){
        var fromHelp = args.fromHelp;
        if(fromHelp){
            // Send this message only if this dialog is triggered through the help
            session.send("Sure, I can help you find the appropriate battlecards");
        }
        builder.Prompts.choice(session, "There are several available battlecards. How would you like to filter battle cards?", "By Offering Type|By Role",{ listStyle: builder.ListStyle.button });
    },
    function(session, results){
        var choice = results.response.entity;
        session.dialogData.filterType = choice;
        var choices;
        switch(choice){
            case 'By Offering Type':
                choices = ['Foundation', 'Migration','DevOps', 'Managed Services', 'Modernization'];
                break;
            case 'By Role':
                choices = ['CIO','CTO','Operations','Security','Network','Architecture','App Owner', 'BI', 'Analytics', 'Data'];
                break;
            default:
                session.send("Sorry, Incorrect Choice. Please try again later");
                session.endDialog();
                break;
        }
        builder.Prompts.choice(session,"Please select one of the following options",choices,{ listStyle: builder.ListStyle.button });
    },
    function(session,results){
        var filterType = session.dialogData.filterType;
        var choice = results.response.entity;
        var battleCards;
        switch(filterType){
            case 'By Offering Type':
                battleCards = getBattlecards(choice,false);
                break;
            case 'By Role':
                battleCards = getBattlecards(false,choice);
                break;
            default:
                session.send("Sorry, Incorrect Choice. Please try again later");
                session.endDialog();
                break;
        }
        if(typeof battleCards[0] == 'undefined'){
            session.send("Sorry, there are no case studies available for the given selection");
            session.send("You can also find battlecards by directly typing into the text-box. Eg: 'Find a migration battle cards' or 'Fetch modernization battlecards for CTO' etc. ");
            session.endDialog();
        } else {
            var msg = buildBattlecardsCarousel(battleCards,session);
            //session.send(JSON.stringify(battleCards));
            session.send(msg);
            session.send("You can also find battlecards by directly typing into the text-box. Eg: 'Find a migration battle cards' or 'Fetch modernization battlecards for CTO' etc. ");
            session.endDialog();
        }
    }
]);

bot.dialog('CustomerPainSurvey',[
    function(session){
        var surveyDict = {
            "Operations":['Patching','Config management','Incident management','Prod deployment','Log Management','Back up','Storage management','Other','Cost driving cloud migration','Other'],
            "Network":['Transit gateway','IDS/IPS/WAF/Proxy','VPN','Other'],
            "Security":['IDS/IPS/WAF/Proxy','End point protection','Access control','IdAM','Log management','Embed security in release process','VPN','DR',"Other"],
            "Architecture":['Blueprints','Pipelines','Dashboards'],
            "App Owner":["Test automation","Release delays","Unplanned work","Rework","Pipeline management","Security policy enforcement","Other"],
            "Data Analytics/BI/AI":["Ingestion","Data catalog and governance","Agile analytics","Data curation","Other"]
        };
        session.dialogData.surveyDict = surveyDict;
        var choices = Object.keys(surveyDict);
        builder.Prompts.choice(session,"Please select your role from one of the following options",choices,{ listStyle: builder.ListStyle.button });
    },
    function(session,results){
        var role = results.response.entity;
        session.dialogData.selectedRole = role;
        var surveyDict = session.dialogData.surveyDict;
        var message = "";
        var pains = surveyDict[role];
        for(var i=0;i<pains.length;i++){
            message += String(i)+ ". " + String(pains[i]) + "\n\n";
        }
        session.send("Please select your %s related pain points. Please type the associated number seperated by comma(,). Eg: 1,4,5",role);
        builder.Prompts.text(session,message);
    },
    function(session,results){
        var resp = results.response;
        var choices = resp.split(',');
        var validChoices = [];
        var givenChoices = session.dialogData.surveyDict[session.dialogData.selectedRole];
        var message = "";
        choices.forEach(function(item){
            if(!isNaN(parseInt(item)) && (parseInt(item) >=0 && parseInt(item) <= givenChoices.length)){
                var index = parseInt(item);
                validChoices.push(givenChoices[index]); 
                message += String(index) + ". " + String(givenChoices[index])+ "\n\n";
            }
        });
        if(typeof validChoices[0] == 'undefined'){
            session.send('Sorry, you did not select any valid pain point. Please type "Begin Pain Customer Survey" to redo the survey');
            session.endDialog();
        } else {
            session.send("Thank you! you have successfully completed the survey.Your response. \n\n %s",message);
            session.sendTyping();
            session.send("Customizing the slide deck..");
            session.send('Please type "Begin Customer Pain Survey", if you want to retake the survey');
            session.endDialog();
        }
        
    }
]).triggerAction({
        matches: "new_customer_pain_survey"
    });

bot.dialog('qnaaaa', function(session) {
    var query = session.message.text;
    session.send("qna triggered");
    session.send(query);     
    // cog.QnAMakerRecognizer.recognize(query, 'https://thesalesbotqnamaker.azurewebsites.net/qnamaker/knowledgebases/ad241d54-dc7f-4806-8d9e-e745aa4a5d32/generateAnswer', '2ed58e10-1717-400b-a1a9-ceeb8d590783', 1, 'intentName', (error, results) => {
    //     session.send(JSON.stringify(results));
    //     session.send(results.answers[0].answer);    
    // })    
    session.send(JSON.stringify(getanswer(query)));
}).triggerAction({
    matches: 'qnaaaa'
});
    
// FAQ through QnAMaker
bot.dialog('qna', function (session, args) {
    var answerEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'answer');
    session.send(answerEntity.entity);
}).triggerAction({
    matches: 'qna'
});

// Basic dialogs
bot.dialog('GreetingDialog',
    (session) => {
        var card = createGreetingHeroCard(session,'greeting');
        var msg = new builder.Message(session).addAttachment(card);
        session.send(msg);
        session.endDialog();
    }
).triggerAction({
    matches: 'greeting'
})

bot.dialog('HelpDialog',
    (session) => {
        session.send('You reached the Help intent. You said \'%s\'.', session.message.text);
        session.endDialog();
    }
).triggerAction({
    matches: 'Help'
})

bot.dialog('CancelDialog',
    (session) => {
        session.send('You reached the Cancel intent. You said \'%s\'.', session.message.text);
        session.endDialog();
    }
).triggerAction({
    matches: 'Cancel'
})

bot.dialog('None',
    (session) => {
        session.send('Sorry, Cannot understand that. Please type "help" if necessary.');
        session.endDialog();
    }).triggerAction({
        matches: 'None'
    });

// Helper Functions
function getCaseStudy(OfferingType, Industry, Enterprise){
    // Function to get case study based on given params
    var CaseStudies = [
        {"Enterprise":"perian dx","Industry":"Healthcare","OfferingType":"Migration","URL":"https://www.reancloud.com/success-story/pieriandx-customer-success-story/","Image":"https://www.reancloud.com/wp-content/uploads/2018/03/PierianDx-CS-Icon-Orange.jpg"},
        {"Enterprise":"aha","Industry":"Healthcare","OfferingType":"Migration","URL":"https://www.reancloud.com/success-story/american-heart-association-customer-success-story/","Image":"https://www.reancloud.com/wp-content/uploads/2018/03/AHA-CS-Icon-Orange.jpg"},
        {"Enterprise":"wics","Industry":"Public Sector","OfferingType":"Migration","URL":"https://www.reancloud.com/success-story/worldwide-incident-command-services-corporation-wics-customer-success-story/","Image":"https://www.reancloud.com/wp-content/uploads/2018/03/WICS-CS-Icon-Orange.jpg"},
        {"Enterprise":"energy sector","Industry":"Public Sector","OfferingType":"Migration","URL":"https://www.reancloud.com/success-story/energy-industry-leader-success-story/","Image":"https://www.reancloud.com/wp-content/uploads/2018/03/commodity-price-reporting-agency-success-story-icon-orange.jpg"},
        {"Enterprise":"aha","Industry":"Healthcare","OfferingType":"Modernization","URL":"https://www.reancloud.com/success-story/american-heart-association-customer-success-story/","Image":"https://www.reancloud.com/wp-content/uploads/2018/03/AHA-CS-Icon-Orange.jpg"},
        {"Enterprise":"smart hospitals","Industry":"Healthcare","OfferingType":"Moderinization","URL":"https://www.reancloud.com/success-story/smart-hospitals-success-story/","Image":"https://www.reancloud.com/wp-content/uploads/2018/04/Smart-Hospitals-CS-Icon-Orange.jpg"},
        {"Enterprise":"telecom","Industry":"Retail","OfferingType":"Moderinization","URL":"https://www.reancloud.com/success-story/large-telecom-company-success-story/","Image":"https://www.reancloud.com/wp-content/uploads/2018/06/CS_Multinational-Telecom-Company-Icon_Orange.jpg"},
        {"Enterprise":"i4c","Industry":"Retail","OfferingType":"modernization","URL":"https://www.reancloud.com/success-story/i4c-innovations-customer-success-story/","Image":"https://www.reancloud.com/wp-content/uploads/2018/03/I4C-Innovations-CS-Icon-Orange.jpg"},
        {"Enterprise":"ditech","Industry":"Financial Services","OfferingType":"Modernization","URL":"https://www.reancloud.com/success-story/ditech-customer-success-story/","Image":"https://www.reancloud.com/wp-content/uploads/2018/03/Ditech-Innovations-CS-Icon-Orange.jpg"},
        {"Enterprise":"citrus pay","Industry":"Financial Services","OfferingType":"Modernization","URL":"https://www.reancloud.com/success-story/citrus-pay-customer-success-story/","Image":"https://www.reancloud.com/wp-content/uploads/2017/03/Citrus-CS-Icon-Orange.png"},
        {"Enterprise":"radian","Industry":"Financial Services","OfferingType":"Modernization","URL":"https://www.reancloud.com/success-story/radian-customer-success-story/","Image":"https://www.reancloud.com/wp-content/uploads/2017/03/Radian-CS-Icon-Orange.png"},
        {"Enterprise":"aegon life","Industry":"Financial Services","OfferingType":"Migration","URL":"https://www.reancloud.com/success-story/aegon-life-case-study/","Image":"https://www.reancloud.com/wp-content/uploads/2018/03/Aegon-Life-CS-Icon-Orange.jpg"},
        {"Enterprise":"elucian","Industry":"Education","OfferingType":"Migration","URL":"https://www.reancloud.com/success-story/ellucian-customer-success-story/","Image":"https://www.reancloud.com/wp-content/uploads/2018/03/Ellucian-CS-Icon-Orange.jpg"},
        {"Enterprise":"sporting goods company","Industry":"Retail","OfferingType":"Migration","URL":"https://www.reancloud.com/success-story/sporting-goods-company-success-story/","Image":"https://www.reancloud.com/wp-content/uploads/2018/08/CS_Sporting-Goods-0ACompany-Case-Study-Icon_Orange.jpg"},
        {"Enterprise":"peacebuilding orginization","Industry":"Non-Profit","OfferingType":"Modernization","URL":"https://www.reancloud.com/success-story/nonprofit-peacebuilding-organization-success-story/","Image":"https://www.reancloud.com/wp-content/uploads/2018/07/PeaceTech-Lab-CS-Icon-Orange.jpg"},
        //{"Enterprise":"","Industry":"","OfferingType":"","URL":""},
       // {"Enterprise":"","Industry":"","OfferingType":"","URL":""}
    ];
    var output = [];
    CaseStudies.forEach(function(item){
        var selectItem = true;
        if(OfferingType && String(item['OfferingType']).toLowerCase().trim() != String(OfferingType).toLowerCase().trim()){
            selectItem = false;
        }
        if(Industry && String(item['Industry']).toLowerCase().trim() != String(Industry).toLowerCase().trim()){
            selectItem = false;
        }
        if(Enterprise && String(item['Enterprise']).toLowerCase().trim() != String(Enterprise).toLowerCase().trim()){
            selectItem = false;
        }
        if(selectItem){
            output.push(item);
        }
    });
    return output;
}

function getBattlecards(OfferingType, Role){
    // Function to get battlecards from given params
    var battleCards = [
        {"OfferingType":"Foundation","Role":"Security", "URL":"https://docs.google.com/presentation/d/1Utb30OXWtomx7P1HkmNjRHcGTWOjzStlYCE-wvUfE1M/edit#slide=id.p1"},
        {"OfferingType":"Foundation","Role":"Network", "URL":"https://docs.google.com/presentation/d/1Utb30OXWtomx7P1HkmNjRHcGTWOjzStlYCE-wvUfE1M/edit#slide=id.p3"},
        {"OfferingType":"Migration","Role":"Architecture", "URL":"https://docs.google.com/presentation/d/1Utb30OXWtomx7P1HkmNjRHcGTWOjzStlYCE-wvUfE1M/edit#slide=id.p2"},
        {"OfferingType":"Migration","Role":"Operations", "URL":"https://docs.google.com/presentation/d/1Utb30OXWtomx7P1HkmNjRHcGTWOjzStlYCE-wvUfE1M/edit#slide=id.p2"},
        {"OfferingType":"Migration","Role":"App Owner", "URL":"https://docs.google.com/presentation/d/1Utb30OXWtomx7P1HkmNjRHcGTWOjzStlYCE-wvUfE1M/edit#slide=id.p2"},
        {"OfferingType":"Managed Services","Role":"Operations", "URL":"https://docs.google.com/presentation/d/1Utb30OXWtomx7P1HkmNjRHcGTWOjzStlYCE-wvUfE1M/edit#slide=id.p4"},
        {"OfferingType":"Managed Services","Role":"CIO", "URL":"https://docs.google.com/presentation/d/1Utb30OXWtomx7P1HkmNjRHcGTWOjzStlYCE-wvUfE1M/edit#slide=id.p4"},
        {"OfferingType":"Managed Services","Role":"CTO", "URL":"https://docs.google.com/presentation/d/1Utb30OXWtomx7P1HkmNjRHcGTWOjzStlYCE-wvUfE1M/edit#slide=id.p4"},
        {"OfferingType":"Managed Services","Role":"App Owner", "URL":"https://docs.google.com/presentation/d/1Utb30OXWtomx7P1HkmNjRHcGTWOjzStlYCE-wvUfE1M/edit#slide=id.p6"},
        {"OfferingType":"Managed Services","Role":"Architecture", "URL":"https://docs.google.com/presentation/d/1Utb30OXWtomx7P1HkmNjRHcGTWOjzStlYCE-wvUfE1M/edit#slide=id.p6"},
        {"OfferingType":"Modernization","Role":"App Owner", "URL":"https://docs.google.com/presentation/d/1Utb30OXWtomx7P1HkmNjRHcGTWOjzStlYCE-wvUfE1M/edit#slide=id.p5"},
        {"OfferingType":"Modernization","Role":"Architecture", "URL":"https://docs.google.com/presentation/d/1Utb30OXWtomx7P1HkmNjRHcGTWOjzStlYCE-wvUfE1M/edit#slide=id.p5"},
        {"OfferingType":"Modernization","Role":"Operations", "URL":"https://docs.google.com/presentation/d/1Utb30OXWtomx7P1HkmNjRHcGTWOjzStlYCE-wvUfE1M/edit#slide=id.p6"},
        {"OfferingType":"Modernization","Role":"CIO", "URL":"https://docs.google.com/presentation/d/1Utb30OXWtomx7P1HkmNjRHcGTWOjzStlYCE-wvUfE1M/edit#slide=id.p6"},
        {"OfferingType":"Modernization","Role":"CTO", "URL":"https://docs.google.com/presentation/d/1Utb30OXWtomx7P1HkmNjRHcGTWOjzStlYCE-wvUfE1M/edit#slide=id.p6"},
        {"OfferingType":"Modernization","Role":"BI", "URL":"https://docs.google.com/presentation/d/1Utb30OXWtomx7P1HkmNjRHcGTWOjzStlYCE-wvUfE1M/edit#slide=id.p7"},
        {"OfferingType":"Modernization","Role":"Analytics", "URL":"https://docs.google.com/presentation/d/1Utb30OXWtomx7P1HkmNjRHcGTWOjzStlYCE-wvUfE1M/edit#slide=id.p7"},
        {"OfferingType":"Modernization","Role":"Data", "URL":"https://docs.google.com/presentation/d/1Utb30OXWtomx7P1HkmNjRHcGTWOjzStlYCE-wvUfE1M/edit#slide=id.p7"} 
    ];
    var output = [];
    battleCards.forEach(function(item){
        var selectItem = true;
        if(OfferingType && String(item['OfferingType']).toLowerCase().trim() != String(OfferingType).toLowerCase().trim()){
            selectItem = false;
        }
        if(Role && String(item['Role']).toLowerCase().trim() != String(Role).toLowerCase().trim()){
            selectItem = false;
        }
        if(selectItem){
            output.push(item);
        }
    });
    return output;
}

function buildCaseStudyCarousel(array, session){
    // Function to build carousel output
    var msg = new builder.Message(session);
    msg.attachmentLayout(builder.AttachmentLayout.carousel);
    var attachments = [];
    array.forEach(function(item){
        var attachment = new builder.HeroCard(session)
                                    .title(String(item['Enterprise']).toUpperCase())
                                    .text("Offering: '%s',\nIndustry: '%s'",item['OfferingType'],item['Industry'])
                                    .images([builder.CardImage.create(session, item['Image'])])
                                    .buttons([
                                        builder.CardAction.openUrl(session,item['URL'],"Case Study URL")
                                    ]);
        attachments.push(attachment);
            
    });
    msg.attachments(attachments);
    return msg;
    
}

function buildBattlecardsCarousel(array, session){
    // Function to build carousel output
    var msg = new builder.Message(session);
    msg.attachmentLayout(builder.AttachmentLayout.carousel);
    var attachments = [];
    array.forEach(function(item){
        var attachment = new builder.HeroCard(session)
                                    .title(String(item['OfferingType']).toUpperCase())
                                    .subtitle(String(item['Role'].toUpperCase()))
                                    .images([builder.CardImage.create(session, 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/Google-Docs-logo-transparent.max-300x300.png')])
                                    .buttons([
                                        builder.CardAction.openUrl(session,item['URL'],"Battlecards URL")
                                    ]);
       attachments.push(attachment);
    });
    msg.attachments(attachments);
    return msg;
}

function createGreetingHeroCard(session,intent){
    // Function to create greeting/help hero cards
    
       return new builder.HeroCard(session)
        .title('Welcome')
        .subtitle('Reanbo')
        .text("Hi. I'm Reanbo, your virtual assistant from REAN Cloud to help you with your sales efforts. Currently, I can help you with the following. Click to an option to continue. ")
        .buttons([
            builder.CardAction.imBack(session, "Find a case study", "Find a case study"),
            builder.CardAction.imBack(session, "Find battle cards", "Find battle cards"),
            builder.CardAction.imBack(session, "Begin customer pain survey", "Begin customer pain survey ")
        ]);
    
    
}

var getanswer = async function(question) {

    try{
        // Add an utterance
        var options = {
            uri: "https://thesalesbotqnamaker.azurewebsites.net/qnamaker/knowledgebases/ad241d54-dc7f-4806-8d9e-e745aa4a5d32/generateAnswer",
            method: 'POST',
            headers: {
                'Authorization': "EndpointKey " + "2ed58e10-1717-400b-a1a9-ceeb8d590783"
            },
            json: true,
            body: question
        };

        var response = await request_as_promised.post(options);
        return response

    } catch (err){
        console.log(err.statusCode);
        console.log(err.message);
        console.log(err.error);
    }
};

getanswer();