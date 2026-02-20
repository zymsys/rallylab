Feature: Late registration on race day

  A participant who was not in the original roster is added and
  checked in after racing has already begun. They receive solo
  catch-up heats for missed rounds, then join remaining group heats.

  Background:
    Given a race is in progress with a started section

  Scenario: Late registrant receives catch-up heats
    Given 2 group heats have been completed
    When the operator adds a new participant "Late Larry"
    And "Late Larry" checks in
    Then 2 solo catch-up heats should be inserted for "Late Larry"
    And the catch-up heats should appear before remaining group heats
    And "Late Larry" should appear in the remaining group heats

  Scenario: Late registrant arriving before any heats complete gets no catch-up
    Given the section has started but no heats are completed
    When the operator adds a new participant "Early Eddie"
    And "Early Eddie" checks in
    Then no catch-up heats should be generated
    And "Early Eddie" should appear in all group heats
