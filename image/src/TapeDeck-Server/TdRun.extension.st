Extension { #name : 'TdRun' }

{ #category : '*TapeDeck-Server' }
TdRun >> adoptRun: aRun [
	"Put a run the runner made from me in my store."

	store ifNotNil: [ :aStore | aStore addRun: aRun ].
	^ aRun
]

{ #category : '*TapeDeck-Server' }
TdRun >> forkAt: aStepOrIndex with: aVariantOrName [
	"Fork me on the runner: replay my tape with the variant up to the step, restore the workspace there and continue live on the real model. Answers the fork, imported (and added to my store)."

	^ self adoptRun: (self runnerClient
			   forkRun: self
			   variant: aVariantOrName
			   at: aStepOrIndex
			   lenient: (self lenientFor: aVariantOrName))
]

{ #category : '*TapeDeck-Server' }
TdRun >> forkWith: aVariantOrName [
	"Fork me where the variant's fork rule says (auto)."

	^ self adoptRun: (self runnerClient forkRun: self variant: aVariantOrName auto: true)
]

{ #category : '*TapeDeck-Server' }
TdRun >> lenientFor: aVariantOrName [
	"A variant object knows what its forks ignore; for a bare name the runner decides."

	^ aVariantOrName isString
		  ifTrue: [ nil ]
		  ifFalse: [ aVariantOrName lenient ]
]

{ #category : '*TapeDeck-Server' }
TdRun >> replayWith: aVariantOrName [
	"Replay my own tape with the variant at zero tokens."

	^ self replayWith: aVariantOrName tape: nil
]

{ #category : '*TapeDeck-Server' }
TdRun >> replayWith: aVariantOrName tape: aTapeOrNil [
	"Replay a tape (e.g. an edited copy of mine) with the variant at zero tokens. Answers the replay run."

	^ self adoptRun: (self runnerClient replayRun: self variant: aVariantOrName tape: aTapeOrNil)
]

{ #category : '*TapeDeck-Server' }
TdRun >> runnerClient [
	"The client for the runner; configure it with TdRunnerClient default: aClient."

	^ TdRunnerClient default
]
